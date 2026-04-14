# ─── General ──────────────────────────────────────────────────────────────

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "playerdev"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region to deploy to"
  type        = string
  default     = "us-east-1"
}

# ─── Networking ──────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# ─── Database ────────────────────────────────────────────────────────────

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "playerdev"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "playerdev"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

# ─── Redis ───────────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.micro"
}

# ─── ECS — API Service ──────────────────────────────────────────────────

variable "api_image" {
  description = "Docker image for the API service (ECR URI)"
  type        = string
}

variable "api_cpu" {
  description = "CPU units for API task (1024 = 1 vCPU)"
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "Memory (MiB) for API task"
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Desired number of API tasks"
  type        = number
  default     = 1
}

# ─── ECS — Web Service ──────────────────────────────────────────────────

variable "web_image" {
  description = "Docker image for the Web service (ECR URI)"
  type        = string
}

variable "web_cpu" {
  description = "CPU units for Web task (1024 = 1 vCPU)"
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Memory (MiB) for Web task"
  type        = number
  default     = 512
}

variable "web_desired_count" {
  description = "Desired number of Web tasks"
  type        = number
  default     = 1
}
