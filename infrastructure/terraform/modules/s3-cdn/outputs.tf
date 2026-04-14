output "video_bucket_name" {
  value = aws_s3_bucket.videos.id
}

output "video_bucket_arn" {
  value = aws_s3_bucket.videos.arn
}

output "csv_bucket_name" {
  value = aws_s3_bucket.csvs.id
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.videos.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.videos.id
}
