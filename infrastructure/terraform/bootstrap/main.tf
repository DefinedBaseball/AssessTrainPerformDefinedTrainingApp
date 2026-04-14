# ─── Bootstrap ───────────────────────────────────────────────────────────
# Run this FIRST to create the S3 bucket and DynamoDB table for
# Terraform remote state. After running, uncomment backend.tf in the
# root module.
#
# Usage:
#   cd infrastructure/terraform/bootstrap
#   terraform init
#   terraform apply
# ─────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# ─── S3 Bucket for Terraform State ──────────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = "playerdev-terraform-state"

  tags = {
    Project   = "player-development"
    ManagedBy = "terraform-bootstrap"
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── DynamoDB Table for State Locking ────────────────────────────────────

resource "aws_dynamodb_table" "tflock" {
  name         = "playerdev-terraform-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Project   = "player-development"
    ManagedBy = "terraform-bootstrap"
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────

output "state_bucket" {
  value = aws_s3_bucket.tfstate.id
}

output "lock_table" {
  value = aws_dynamodb_table.tflock.name
}
