# ─── Networking ──────────────────────────────────────────────────────────

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

# ─── Database ────────────────────────────────────────────────────────────

output "db_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.db_endpoint
  sensitive   = true
}

# ─── Redis ───────────────────────────────────────────────────────────────

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.redis.redis_endpoint
}

# ─── Storage & CDN ──────────────────────────────────────────────────────

output "video_bucket_name" {
  description = "S3 bucket for video storage"
  value       = module.s3_cdn.video_bucket_name
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain"
  value       = module.s3_cdn.cloudfront_domain
}

# ─── Auth ────────────────────────────────────────────────────────────────

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = module.cognito.client_id
}

# ─── ECS / Load Balancer ────────────────────────────────────────────────

output "api_url" {
  description = "API service URL (ALB DNS)"
  value       = module.ecs.api_url
}

output "web_url" {
  description = "Web app URL (ALB DNS)"
  value       = module.ecs.web_url
}

output "api_ecr_repo" {
  description = "ECR repository URL for API"
  value       = module.ecs.api_ecr_repo
}

output "web_ecr_repo" {
  description = "ECR repository URL for Web"
  value       = module.ecs.web_ecr_repo
}
