# Phase 3 — Terraform, VPC, RDS, S3, ECR, ECS Fargate

**Mục tiêu:** đưa worker lên chạy trên AWS, và **codify toàn bộ hạ tầng bằng Terraform**.
**Thời gian:** 2 tuần — phase nhiều khái niệm AWS mới nhất
**Chi phí:** ~$15/tháng (RDS ~$14, Fargate chỉ khi bật, S3/ECR gần $0)
**Kết quả:** `terraform apply` dựng toàn bộ hạ tầng, `terraform destroy` xóa sạch. Đây là nút bật/tắt chi phí của bạn.

---

## 3.0. Vì sao Terraform ngay bây giờ

Thiết kế ban đầu để Infrastructure as Code tận Phase 8. Tôi dời lên đây vì một lý do thực dụng: **khả năng destroy và dựng lại trong 5 phút là công cụ kiểm soát chi phí quan trọng nhất của bạn.**

Hạ tầng click tay thì không ai dám xóa — sợ dựng lại mất cả buổi. Và đó chính xác là cách $200 bốc hơi: mọi thứ cứ chạy vì xóa thì phiền.

Với Terraform, cuối tuần bạn gõ `terraform destroy`, thứ Hai gõ `terraform apply`, mất 5 phút và tiết kiệm 2 ngày tiền RDS.

> 💡 **Terraform là gì:** bạn mô tả hạ tầng mong muốn bằng file text (`.tf`), Terraform so sánh với thực tế trên AWS rồi tạo/sửa/xóa cho khớp. File `.tfstate` lưu "Terraform nghĩ hiện đang có gì". Ba lệnh cần biết: `terraform plan` (xem sẽ thay đổi gì, **không** đổi thật), `terraform apply` (thực hiện), `terraform destroy` (xóa hết).

---

## 3.1. Thứ tự thực hiện

```
3.2  Terraform backend (S3 lưu state)
3.3  Module network — VPC, subnet, security group
3.4  Module queues  — import 4 queue đã tạo tay ở Phase 2
3.5  Module storage — S3 bucket kết quả
3.6  Module database— RDS MySQL
3.7  Docker image + ECR
3.8  Module compute — ECS cluster, task definition, service
3.9  IAM roles
3.10 Chạy migration
3.11 Kiểm thử + scripts wake/sleep
```

---

## 3.2. Terraform backend

> 💡 **Vì sao không để state trên máy:** file `.tfstate` chứa **toàn bộ thông tin hạ tầng, kể cả mật khẩu RDS dạng plain text**. Để trên máy thì mất máy là mất state (không destroy được nữa, tài nguyên chạy mãi mà bạn không biết cách xóa). Để lên S3 thì an toàn, có version, và bật mã hóa.

Tạo bucket bằng tay (chỉ một lần, không thể dùng Terraform để tạo backend của chính nó):

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile taskflow)
REGION=ap-southeast-1

aws s3api create-bucket \
  --bucket taskflow-tfstate-$ACCOUNT_ID \
  --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION \
  --profile taskflow

# Versioning: lỡ tay hỏng state thì khôi phục được bản trước
aws s3api put-bucket-versioning \
  --bucket taskflow-tfstate-$ACCOUNT_ID \
  --versioning-configuration Status=Enabled --profile taskflow

# Chặn public hoàn toàn
aws s3api put-public-access-block \
  --bucket taskflow-tfstate-$ACCOUNT_ID \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  --profile taskflow
```

`infrastructure/terraform/envs/learning/backend.tf`:

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket       = "taskflow-tfstate-123456789012"   # thay ACCOUNT_ID
    key          = "learning/terraform.tfstate"      # prod-like dùng key KHÁC -> state tách biệt
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true                              # khóa chống chạy apply đồng thời
  }
}

provider "aws" {
  region = var.region

  # default_tags: mọi tài nguyên tự động có tag này. Không phải lặp lại ở từng resource,
  # và đảm bảo Cost Explorer luôn phân loại đúng.
  default_tags {
    tags = {
      Project     = "taskflow"
      Environment = "learning"
      ManagedBy   = "terraform"
    }
  }
}
```

`variables.tf`:

```hcl
variable "region"      { type = string  default = "ap-southeast-1" }
variable "project"     { type = string  default = "taskflow" }
variable "environment" { type = string  default = "learning" }
variable "db_password" { type = string  sensitive = true }
```

`terraform.tfvars` (**đã nằm trong .gitignore**):

```hcl
db_password = "mat-khau-manh-cua-ban"
```

```bash
cd infrastructure/terraform/envs/learning
terraform init
```

---

## 3.3. Module network

> 💡 **VPC là gì:** Virtual Private Cloud — mạng riêng ảo của bạn trong AWS. Mọi thứ có địa chỉ IP (EC2, RDS, ECS task) đều nằm trong một VPC.
>
> **Subnet** — chia nhỏ VPC theo **Availability Zone** (AZ = một trung tâm dữ liệu vật lý). Có 2 loại:
> - **Public subnet**: có đường ra Internet trực tiếp qua Internet Gateway. Tài nguyên ở đây *có thể* có IP công khai.
> - **Private subnet**: không có đường ra trực tiếp. Muốn gọi Internet phải qua **NAT Gateway** — và NAT Gateway tốn **$32/tháng**.
>
> **Security Group** — tường lửa ở cấp tài nguyên. Mặc định chặn hết inbound, cho hết outbound. Đây là lớp bảo vệ chính của ta.

**Quyết định của Learning Mode: đặt mọi thứ ở public subnet, KHÔNG dùng NAT Gateway.** Tiết kiệm $32/tháng — gần bằng 2 tháng RDS. Đổi lại, an toàn dựa vào Security Group thay vì cách ly mạng. Chấp nhận được vì không có dữ liệu thật. Phase 8 sẽ làm đúng chuẩn để so sánh.

`modules/network/main.tf`:

```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true      # cần cho RDS endpoint phân giải được
  tags = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

# 2 AZ: RDS yêu cầu subnet group trải ít nhất 2 AZ, kể cả khi single-AZ.
data "aws_availability_zones" "available" { state = "available" }

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.project}-public-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project}-rt-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# S3 Gateway Endpoint — MIỄN PHÍ và nên bật luôn.
# ECS kéo image từ ECR, mà ECR lưu layer trên S3. Endpoint này khiến traffic đó
# đi trong mạng AWS thay vì ra Internet -> nhanh hơn và không tốn data transfer.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags = { Name = "${var.project}-s3-endpoint" }
}
```

`security_groups.tf`:

```hcl
# Worker: KHÔNG có inbound nào. Chỉ gọi ra (SQS, S3, ECR, CloudWatch).
resource "aws_security_group" "worker" {
  name        = "${var.project}-worker-sg"
  description = "ECS worker — outbound only"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-worker-sg" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds-sg"
  description = "RDS MySQL"
  vpc_id      = aws_vpc.main.id

  # Từ worker — tham chiếu theo SG ID, không phải dải IP.
  # IP của Fargate task thay đổi mỗi lần khởi động nên chỉ cách này mới đúng.
  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  # Từ máy bạn — để Laravel local và các lệnh migrate kết nối được.
  ingress {
    from_port   = 3306
    to_port     = 3306
    protocol    = "tcp"
    cidr_blocks = ["${var.my_ip}/32"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-rds-sg" }
}
```

> ⚠️ `var.my_ip` là IP công khai của bạn (`curl ifconfig.me`). Nhà mạng đổi IP thì phải `terraform apply` lại. Phiền một chút nhưng đây là thứ duy nhất bảo vệ RDS khỏi Internet ở Learning Mode — **đừng đặt `0.0.0.0/0`**.

---

## 3.4. Module queues — import queue đã tạo tay

Phase 2 bạn tạo queue bằng console. Giờ đưa chúng vào Terraform quản lý, **không xóa đi tạo lại**.

`modules/queues/main.tf`:

```hcl
resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${var.project}-jobs-dlq"
  message_retention_seconds = 1209600   # 14 ngày
  receive_wait_time_seconds = 20
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.project}-jobs"
  visibility_timeout_seconds = 180
  message_retention_seconds  = 345600   # 4 ngày
  receive_wait_time_seconds  = 20       # long polling — bẫy chi phí lớn nhất nếu quên

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "notifications_dlq" {
  name                      = "${var.project}-notifications-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${var.project}-notifications"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    maxReceiveCount     = 3
  })
}
```

Import:

```bash
terraform import 'module.queues.aws_sqs_queue.jobs' \
  https://sqs.ap-southeast-1.amazonaws.com/ACCOUNT_ID/taskflow-jobs
terraform import 'module.queues.aws_sqs_queue.jobs_dlq' \
  https://sqs.ap-southeast-1.amazonaws.com/ACCOUNT_ID/taskflow-jobs-dlq
# tương tự cho 2 queue notifications
```

Sau đó `terraform plan` — kết quả phải là **"No changes"**. Nếu có thay đổi, tức là code Terraform chưa khớp với cấu hình bạn đã click ở Phase 2; sửa code cho khớp thay vì để Terraform sửa queue.

> 💡 `terraform import` là kỹ năng thực tế rất hay dùng: hầu hết công ty đều có hạ tầng click tay từ trước rồi mới chuyển sang IaC. Làm một lần ở đây để biết cảm giác.

---

## 3.5. Module storage — S3

> 💡 **S3 là gì:** object storage — lưu file theo cặp key/value, không có thư mục thật (dấu `/` trong tên chỉ là quy ước hiển thị). Rẻ ($0.023/GB/tháng), bền, dung lượng vô hạn. Dự án dùng nó lưu file CSV/PDF kết quả, vì nhét file vào database hay vào message SQS đều sai.

```hcl
resource "aws_s3_bucket" "results" {
  bucket = "${var.project}-results-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket                  = aws_s3_bucket.results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Lifecycle rule: tự xóa file cũ hơn 7 ngày.
# Miễn phí, không cần code, không thể hỏng — luôn ưu tiên hơn viết Lambda dọn dẹp.
resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    id     = "expire-results"
    status = "Enabled"
    filter { prefix = "results/" }
    expiration { days = 7 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
```

Bucket **không public**. File tải về qua **pre-signed URL** — URL có chữ ký, hết hạn sau 15 phút:

```php
final class S3ResultStorage implements ResultStorage
{
    public function put(string $key, string $contents): string {
        Storage::disk('s3')->put($key, $contents);
        return $key;
    }
    public function temporaryUrl(string $key, int $minutes = 15): string {
        return Storage::disk('s3')->temporaryUrl($key, now()->addMinutes($minutes));
    }
}
```

```bash
composer require league/flysystem-aws-s3-v3
```

---

## 3.6. Module database — RDS

> 💡 **RDS là gì:** MySQL do AWS vận hành — họ lo backup, vá lỗi, khôi phục khi hỏng phần cứng. Bạn chỉ dùng như một MySQL bình thường qua endpoint.
>
> **`db.t4g.micro`** — 2 vCPU (burstable), 1 GB RAM, dùng chip ARM Graviton. ~$11.7/tháng, rẻ hơn `db.t3.micro` (Intel) khoảng 10% với hiệu năng tương đương.

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnet"
  subnet_ids = var.subnet_ids     # cần >= 2 AZ dù chỉ chạy single-AZ
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "mysql"
  engine_version = "8.0"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 0        # TẮT autoscaling storage — tránh phình chi phí ngoài ý muốn
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "taskflow"
  username = "taskflow"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_security_group_id]
  publicly_accessible    = true    # Learning Mode; Phase 8 đổi thành false

  multi_az                = false  # Multi-AZ gấp đôi giá, không học thêm gì ở giai đoạn này
  backup_retention_period = 1      # 1 ngày là đủ; 0 sẽ tắt hẳn backup
  skip_final_snapshot     = true   # cho phép destroy nhanh — CHỈ dùng ở môi trường học
  deletion_protection     = false

  # Tắt các tính năng tính phí thêm
  performance_insights_enabled = false
  monitoring_interval          = 0

  apply_immediately = true
}
```

> ⚠️ `skip_final_snapshot = true` nghĩa là `terraform destroy` **xóa sạch dữ liệu, không hỏi lại**. Đúng với môi trường học (destroy thường xuyên là mục tiêu), nhưng tuyệt đối không dùng ở production.

---

## 3.7. Docker image và ECR

> 💡 **ECR là gì:** Elastic Container Registry — Docker Hub riêng của bạn trên AWS. ECS kéo image từ đây. $0.10/GB/tháng, 500 MB đầu miễn phí.

`backend/Dockerfile.worker`:

```dockerfile
FROM php:8.1-cli-alpine

RUN apk add --no-cache libzip-dev icu-dev $PHPIZE_DEPS \
 && docker-php-ext-install pdo_mysql bcmath opcache pcntl zip \
 && apk del $PHPIZE_DEPS
# pcntl BẮT BUỘC: không có nó thì không bắt được SIGTERM,
# và Phase 4 (scale in an toàn) sẽ không hoạt động.

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

COPY . .
RUN composer dump-autoload --optimize \
 && php artisan config:cache \
 && php artisan route:cache

# Chạy bằng user không phải root
RUN addgroup -g 1000 app && adduser -u 1000 -G app -s /bin/sh -D app \
 && chown -R app:app /app/storage /app/bootstrap/cache
USER app

CMD ["php", "artisan", "taskflow:consume"]
```

Terraform cho ECR:

```hcl
resource "aws_ecr_repository" "worker" {
  name                 = "${var.project}-worker"
  image_tag_mutability = "IMMUTABLE"    # tag đã push không sửa được -> rollback đáng tin
  image_scanning_configuration { scan_on_push = true }
}

# Lifecycle policy: chỉ giữ 5 image gần nhất.
# Không có cái này, sau 50 lần build là 10GB và tăng mãi mãi.
resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Giữ 5 image gần nhất"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
    }]
  })
}
```

Build và push — `scripts/build-push.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile taskflow)
REGION=ap-southeast-1
REPO="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/taskflow-worker"
TAG=$(git rev-parse --short HEAD)     # tag = git SHA, KHÔNG dùng :latest

aws ecr get-login-password --region $REGION --profile taskflow \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# ARM64: Fargate Graviton rẻ hơn ~20% so với x86 cùng hiệu năng
docker buildx build --platform linux/arm64 \
  -f backend/Dockerfile.worker \
  -t "$REPO:$TAG" -t "$REPO:latest" \
  --push backend/

echo "Đã push: $REPO:$TAG"
```

> ⚠️ Tag bằng git SHA để biết chính xác đang chạy phiên bản nào và rollback được. `:latest` khiến bạn không bao giờ biết ECS đang chạy code nào.

---

## 3.8. IAM roles cho ECS

> 💡 **Vì sao Role chứ không phải access key:** Role cấp credentials **tạm thời**, tự động xoay vòng, không bao giờ nằm trên đĩa hay trong biến môi trường. Không có gì để rò rỉ. Đây là lý do từ phase này trở đi ta xóa hẳn access key khỏi worker.
>
> ECS cần **hai** role khác nhau — điểm gây nhầm lẫn kinh điển:
> - **Task Execution Role**: dùng bởi *chính ECS agent*, trước khi container chạy. Để kéo image từ ECR và tạo log stream.
> - **Task Role**: dùng bởi *code trong container*. Để gọi SQS, S3, SES.

```hcl
# ===== Execution role =====
resource "aws_iam_role" "execution" {
  name = "${var.project}-ecs-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Cho phép đọc secret từ Parameter Store để inject vào container
resource "aws_iam_role_policy" "execution_ssm" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/taskflow/*"
    }]
  })
}

# ===== Task role — quyền của ứng dụng, least privilege thật sự =====
resource "aws_iam_role" "worker_task" {
  name = "${var.project}-worker-task-role"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}

resource "aws_iam_role_policy" "worker_task" {
  role = aws_iam_role.worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConsumeJobs"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage", "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"
        ]
        Resource = var.jobs_queue_arn
      },
      {
        # Worker CHỈ được gửi vào notifications, KHÔNG được gửi vào jobs.
        # Nó tiêu thụ job, không tạo job. Least privilege thật, không hình thức.
        Sid      = "EmitEvents"
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = var.notifications_queue_arn
      },
      {
        Sid      = "StoreResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${var.results_bucket_arn}/*"
      }
    ]
  })
}
```

---

## 3.9. Module compute — ECS Fargate

> 💡 **ECS là gì:** Elastic Container Service — dịch vụ chạy Docker container. Ba khái niệm:
> - **Cluster** — nhóm logic, chỉ là cái tên. Miễn phí.
> - **Task definition** — "công thức": image nào, bao nhiêu CPU/RAM, biến môi trường gì, log đi đâu. Giống `docker-compose.yml`. Mỗi lần sửa tạo ra một **revision** mới.
> - **Service** — giữ cho N task luôn chạy. Task chết thì service tự tạo cái mới. Auto Scaling ở Phase 4 sẽ điều chỉnh chính con số N này.
>
> **Fargate là gì:** chế độ chạy container **không cần quản lý máy chủ**. Không EC2 để vá lỗi, không lo dung lượng. Bạn trả tiền theo vCPU-giây và GB-giây thực dùng. Đắt hơn EC2 nếu chạy 24/7, nhưng rẻ hơn hẳn với workload lúc có lúc không — đúng trường hợp của ta.

```hcl
resource "aws_ecs_cluster" "main" {
  name = var.project

  setting {
    name  = "containerInsights"
    value = "disabled"    # Phase 4 mới bật (cần RunningTaskCount). Bật sớm là tốn tiền vô ích.
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/taskflow/ecs-worker"
  retention_in_days = 7     # BẮT BUỘC đặt. Mặc định "never expire" = trả tiền lưu trữ mãi mãi.
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"    # 0.25 vCPU
  memory                   = "512"    # 512 MB

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"   # Graviton, rẻ hơn ~20%
  }

  execution_role_arn = var.execution_role_arn
  task_role_arn      = var.task_role_arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${var.ecr_repository_url}:${var.image_tag}"
    essential = true

    # stopTimeout: ECS gửi SIGTERM rồi chờ NGẦN NÀY giây mới SIGKILL.
    # Mặc định chỉ 30s — job 60s sẽ bị giết ngang. 120 là tối đa của Fargate.
    stopTimeout = 120

    environment = [
      { name = "APP_ENV",                 value = "production" },
      { name = "TASKFLOW_QUEUE_DRIVER",   value = "sqs" },
      { name = "TASKFLOW_EVENT_DRIVER",   value = "log" },   # Phase 6 đổi thành sqs
      { name = "TASKFLOW_STORAGE_DRIVER", value = "s3" },
      { name = "TASKFLOW_METRICS_DRIVER", value = "null" },  # Phase 7 đổi thành emf
      { name = "AWS_DEFAULT_REGION",      value = var.region },
      { name = "AWS_ACCOUNT_ID",          value = var.account_id },
      { name = "DB_HOST",                 value = var.db_host },
      { name = "DB_DATABASE",             value = "taskflow" },
      { name = "DB_USERNAME",             value = "taskflow" },
      { name = "AWS_BUCKET",              value = var.results_bucket },
    ]

    # secrets: ECS đọc từ Parameter Store và inject làm biến môi trường.
    # Giá trị không bao giờ xuất hiện trong task definition hay console.
    secrets = [
      { name = "DB_PASSWORD", valueFrom = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/taskflow/learning/DB_PASSWORD" },
      { name = "APP_KEY",     valueFrom = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/taskflow/learning/APP_KEY" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "${var.project}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.desired_count     # mặc định 0 — bật khi cần
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.worker_security_group_id]
    assign_public_ip = true    # BẮT BUỘC ở public subnet: không có IP công khai
                               # thì task không kéo được image từ ECR và deploy sẽ treo.
                               # ~$3.6/tháng/IP — vẫn rẻ hơn NAT Gateway 9 lần.
  }

  # Phase 4 sẽ chỉnh desired_count qua Auto Scaling.
  # Không có dòng này, terraform apply sẽ kéo ngược nó về giá trị trong code.
  lifecycle {
    ignore_changes = [desired_count]
  }
}
```

Đưa secret lên Parameter Store:

```bash
aws ssm put-parameter --name /taskflow/learning/DB_PASSWORD \
  --value 'mat-khau-cua-ban' --type SecureString --profile taskflow

aws ssm put-parameter --name /taskflow/learning/APP_KEY \
  --value "$(cd backend && php artisan key:generate --show)" \
  --type SecureString --profile taskflow
```

> 💡 **Parameter Store vs Secrets Manager:** Secrets Manager có tính năng tự động xoay vòng mật khẩu, giá $0.40/secret/tháng. Parameter Store Standard **miễn phí** và làm được mọi thứ ta cần. 5 secret × 6 tháng = $12 tiết kiệm được.

---

## 3.10. Ghép lại và apply

`envs/learning/main.tf`:

```hcl
module "network" {
  source  = "../../modules/network"
  project = var.project
  region  = var.region
  my_ip   = var.my_ip
}

module "queues"  { source = "../../modules/queues"  project = var.project }
module "storage" { source = "../../modules/storage" project = var.project }

module "database" {
  source                = "../../modules/database"
  project               = var.project
  subnet_ids            = module.network.public_subnet_ids
  rds_security_group_id = module.network.rds_security_group_id
  db_password           = var.db_password
}

module "iam" {
  source                  = "../../modules/iam"
  project                 = var.project
  region                  = var.region
  account_id              = data.aws_caller_identity.current.account_id
  jobs_queue_arn          = module.queues.jobs_arn
  notifications_queue_arn = module.queues.notifications_arn
  results_bucket_arn      = module.storage.bucket_arn
}

module "compute" {
  source                   = "../../modules/compute"
  project                  = var.project
  region                   = var.region
  account_id               = data.aws_caller_identity.current.account_id
  subnet_ids               = module.network.public_subnet_ids
  worker_security_group_id = module.network.worker_security_group_id
  execution_role_arn       = module.iam.execution_role_arn
  task_role_arn            = module.iam.worker_task_role_arn
  ecr_repository_url       = module.storage.ecr_worker_url
  image_tag                = var.image_tag
  db_host                  = module.database.endpoint
  results_bucket           = module.storage.bucket_name
  desired_count            = 0     # bật bằng scripts/wake.sh
}
```

```bash
terraform plan     # ĐỌC KỸ trước khi apply
terraform apply
```

Lần đầu mất ~10 phút (RDS chiếm phần lớn).

---

## 3.11. Chạy migration

RDS đang trống. Vì `publicly_accessible = true` và SG đã cho IP của bạn, chạy từ local là đơn giản nhất:

```bash
cd backend
# .env trỏ tới RDS endpoint
DB_HOST=taskflow-db.xxxx.ap-southeast-1.rds.amazonaws.com php artisan migrate --force
```

> Ở Phase 8 khi RDS nằm trong private subnet, cách này không dùng được nữa — lúc đó dùng `aws ecs run-task` với một one-off task. Xem `scripts/migrate.sh` ở Phase 8.

---

## 3.12. Scripts wake/sleep — công cụ tiết kiệm hằng ngày

`scripts/wake.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PROFILE=taskflow

echo "Khởi động RDS..."
aws rds start-db-instance --db-instance-identifier taskflow-db --profile $PROFILE 2>/dev/null \
  || echo "  (RDS đã chạy)"

echo "Chờ RDS sẵn sàng..."
aws rds wait db-instance-available --db-instance-identifier taskflow-db --profile $PROFILE

echo "Bật 1 worker..."
aws ecs update-service --cluster taskflow --service taskflow-worker \
  --desired-count 1 --profile $PROFILE >/dev/null

echo "Sẵn sàng."
```

`scripts/sleep.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PROFILE=taskflow

echo "Tắt worker..."
aws ecs update-service --cluster taskflow --service taskflow-worker \
  --desired-count 0 --profile $PROFILE >/dev/null

echo "Dừng RDS (tối đa 7 ngày)..."
aws rds stop-db-instance --db-instance-identifier taskflow-db --profile $PROFILE >/dev/null

echo "Đã tắt. Chi phí còn lại: chỉ storage (~$2.3/tháng)."
```

> ⚠️ **RDS chỉ dừng được tối đa 7 ngày**, sau đó AWS tự khởi động lại. Nghỉ dài hơn thì `terraform destroy` (dữ liệu học tập không cần giữ) hoặc snapshot thủ công rồi xóa instance.

---

## 3.13. Kiểm thử Phase 3

```bash
./scripts/wake.sh

# Xem worker đã chạy chưa
aws ecs list-tasks --cluster taskflow --service-name taskflow-worker --profile taskflow

# Xem log realtime
aws logs tail /taskflow/ecs-worker --follow --profile taskflow
```

Tạo job từ React (Laravel vẫn chạy local, trỏ vào RDS và SQS thật) → xem log ECS xử lý → job `completed` → file kết quả xuất hiện trong S3.

**Test destroy/rebuild — quan trọng nhất của phase này:**

```bash
terraform destroy      # gõ yes
terraform apply        # dựng lại
cd backend && php artisan migrate --force
```

Nếu quy trình này chạy trơn tru, bạn đã có nút tắt chi phí. Nếu vướng chỗ nào, sửa Terraform cho tới khi trơn — công sức bỏ ra ở đây tiết kiệm tiền suốt 5 phase còn lại.

---

## Definition of Done — Phase 3

- [ ] `terraform apply` dựng được toàn bộ từ con số không
- [ ] `terraform plan` sau apply trả về **"No changes"**
- [ ] `terraform destroy` rồi `apply` lại thành công (**đã thử thật**)
- [ ] State nằm trên S3, có versioning, không có `.tfstate` nào trong git
- [ ] Worker chạy trên Fargate, log đổ về `/taskflow/ecs-worker`
- [ ] Log group có **retention 7 ngày** (không phải "never expire")
- [ ] Worker **không có** access key nào — dùng Task Role
- [ ] Job tạo từ local được worker trên AWS xử lý
- [ ] `generate_report` ghi file lên S3, tải được bằng pre-signed URL
- [ ] ECR có lifecycle policy giữ 5 image
- [ ] Image build cho **ARM64**
- [ ] `wake.sh` / `sleep.sh` chạy được
- [ ] Cost Explorer hiện tag `Project=taskflow`
- [ ] Chi phí ước tính tháng < $20

**→ Tiếp theo: [Phase 4 — Auto Scaling](phase-4-autoscaling.md)**
