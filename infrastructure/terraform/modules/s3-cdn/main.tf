# ─── S3 + CloudFront Module ──────────────────────────────────────────────
# S3 buckets for video storage and CSV uploads, CloudFront CDN for
# video delivery with signed URLs.
# ─────────────────────────────────────────────────────────────────────────

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# ─── Video Storage Bucket ───────────────────────────────────────────────

resource "aws_s3_bucket" "videos" {
  bucket        = "${local.name_prefix}-videos"
  force_destroy = var.environment != "prod"

  tags = { Name = "${local.name_prefix}-videos" }
}

resource "aws_s3_bucket_versioning" "videos" {
  bucket = aws_s3_bucket.videos.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "videos" {
  bucket = aws_s3_bucket.videos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: move to IA at 90 days, Glacier at 365 days
resource "aws_s3_bucket_lifecycle_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  rule {
    id     = "archive-old-videos"
    status = "Enabled"

    filter {
      prefix = "uploads/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }

  rule {
    id     = "clean-failed-uploads"
    status = "Enabled"

    filter {
      prefix = "temp/"
    }

    expiration {
      days = 1
    }
  }
}

# CORS for presigned upload from mobile/web
resource "aws_s3_bucket_cors_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = ["*"]  # Lock down to specific domains in prod
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 3600
  }
}

# ─── CSV Upload Bucket ──────────────────────────────────────────────────

resource "aws_s3_bucket" "csvs" {
  bucket        = "${local.name_prefix}-csv-uploads"
  force_destroy = var.environment != "prod"

  tags = { Name = "${local.name_prefix}-csv-uploads" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "csvs" {
  bucket = aws_s3_bucket.csvs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "csvs" {
  bucket = aws_s3_bucket.csvs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "csvs" {
  bucket = aws_s3_bucket.csvs.id

  rule {
    id     = "expire-processed-csvs"
    status = "Enabled"

    filter {
      prefix = "processed/"
    }

    expiration {
      days = 30
    }
  }
}

# ─── CloudFront Origin Access Control ────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "videos" {
  name                              = "${local.name_prefix}-video-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── CloudFront Distribution ────────────────────────────────────────────

resource "aws_cloudfront_distribution" "videos" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} video CDN"

  origin {
    domain_name              = aws_s3_bucket.videos.bucket_regional_domain_name
    origin_id                = "S3-videos"
    origin_access_control_id = aws_cloudfront_origin_access_control.videos.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-videos"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400    # 24 hours
    max_ttl     = 31536000 # 1 year

    compress = true
  }

  # HLS streaming cache behavior
  ordered_cache_behavior {
    path_pattern           = "/processed/*.m3u8"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-videos"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600    # 1 hour for manifests
    max_ttl     = 86400
    compress    = true
  }

  ordered_cache_behavior {
    path_pattern           = "/processed/*.ts"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-videos"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 604800   # 7 days for segments
    max_ttl     = 31536000
    compress    = false     # TS segments are already compressed
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${local.name_prefix}-video-cdn" }
}

# ─── S3 Bucket Policy — allow CloudFront OAC ───────────────────────────

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_policy" "videos_cf" {
  bucket = aws_s3_bucket.videos.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.videos.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.videos.arn
        }
      }
    }]
  })
}
