output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "api_url" {
  description = "API URL via ALB"
  value       = "http://${aws_lb.main.dns_name}/api"
}

output "web_url" {
  description = "Web app URL via ALB"
  value       = "http://${aws_lb.main.dns_name}"
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "api_ecr_repo" {
  value = aws_ecr_repository.api.repository_url
}

output "web_ecr_repo" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}
