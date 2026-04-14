# ─── Remote State Storage ─────────────────────────────────────────────────
# Uncomment and configure when ready for team/CI usage.
# First, create the S3 bucket and DynamoDB table manually or via a
# separate bootstrap Terraform config.
# ──────────────────────────────────────────────────────────────────────────

# terraform {
#   backend "s3" {
#     bucket         = "playerdev-terraform-state"
#     key            = "infrastructure/terraform.tfstate"
#     region         = "us-east-1"
#     encrypt        = true
#     dynamodb_table = "playerdev-terraform-lock"
#   }
# }
