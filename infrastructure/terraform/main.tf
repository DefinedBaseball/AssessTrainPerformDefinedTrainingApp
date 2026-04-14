# ─── Player Development App — AWS Infrastructure ─────────────────────────
# Terraform root module — orchestrates all AWS resources
# ──────────────────────────────────────────────────────────────────────────

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
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "player-development"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ─── Networking ──────────────────────────────────────────────────────────

module "vpc" {
  source = "./modules/vpc"

  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
}

# ─── Database (PostgreSQL on RDS) ────────────────────────────────────────

module "rds" {
  source = "./modules/rds"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = var.db_password
  db_instance_class  = var.db_instance_class
  ecs_security_group = module.ecs.ecs_security_group_id
}

# ─── Cache (Redis on ElastiCache) ───────────────────────────────────────

module "redis" {
  source = "./modules/redis"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  ecs_security_group = module.ecs.ecs_security_group_id
  node_type          = var.redis_node_type
}

# ─── Storage & CDN (S3 + CloudFront) ────────────────────────────────────

module "s3_cdn" {
  source = "./modules/s3-cdn"

  project_name = var.project_name
  environment  = var.environment
}

# ─── Auth (AWS Cognito) ─────────────────────────────────────────────────

module "cognito" {
  source = "./modules/cognito"

  project_name = var.project_name
  environment  = var.environment
}

# ─── Compute (ECS Fargate) ──────────────────────────────────────────────

module "ecs" {
  source = "./modules/ecs"

  project_name       = var.project_name
  environment        = var.environment
  aws_region         = var.aws_region
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids

  # API config
  api_image          = var.api_image
  api_cpu            = var.api_cpu
  api_memory         = var.api_memory
  api_desired_count  = var.api_desired_count

  # Web config
  web_image          = var.web_image
  web_cpu            = var.web_cpu
  web_memory         = var.web_memory
  web_desired_count  = var.web_desired_count

  # Environment variables for API
  database_url       = "postgresql://${var.db_username}:${var.db_password}@${module.rds.db_endpoint}/${var.db_name}?schema=public"
  redis_url          = "redis://${module.redis.redis_endpoint}:6379"
  s3_bucket          = module.s3_cdn.video_bucket_name
  cloudfront_domain  = module.s3_cdn.cloudfront_domain
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
}
