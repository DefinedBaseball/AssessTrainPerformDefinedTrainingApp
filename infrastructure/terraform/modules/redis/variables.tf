variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group" {
  description = "Security group of ECS tasks (allowed to connect)"
  type        = string
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}
