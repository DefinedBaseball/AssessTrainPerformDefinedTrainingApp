# ─── Cognito Module ──────────────────────────────────────────────────────
# AWS Cognito User Pool with custom attributes for coach/player roles,
# password policies, and an app client for the mobile/web apps.
# ─────────────────────────────────────────────────────────────────────────

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# ─── User Pool ───────────────────────────────────────────────────────────

resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-users"

  # Sign-in options
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Custom attributes for role-based access
  schema {
    name                     = "role"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  schema {
    name                     = "player_id"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 0
      max_length = 128
    }
  }

  # Email configuration (use Cognito default for dev)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # User verification
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Player Development App - Verify your email"
    email_message        = "Your verification code is {####}"
  }

  # MFA (optional, can enable later)
  mfa_configuration = "OFF"

  tags = { Name = "${local.name_prefix}-user-pool" }
}

# ─── App Client ──────────────────────────────────────────────────────────

resource "aws_cognito_user_pool_client" "app" {
  name         = "${local.name_prefix}-app-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  # Token validity
  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # No client secret for mobile/SPA apps
  generate_secret = false

  # Read/write attributes
  read_attributes  = ["email", "custom:role", "custom:player_id"]
  write_attributes = ["email"]

  # Prevent user existence errors (security)
  prevent_user_existence_errors = "ENABLED"
}

# ─── User Groups ─────────────────────────────────────────────────────────

resource "aws_cognito_user_group" "coaches" {
  name         = "coaches"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Coaches — full CRUD access to all athletes"
  precedence   = 1
}

resource "aws_cognito_user_group" "players" {
  name         = "players"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Players — read-only access to own profile and public leaderboards"
  precedence   = 10
}
