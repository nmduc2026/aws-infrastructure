# Phase 8 — Production-like (có thời hạn)

**Mục tiêu:** dựng kiến trúc đúng chuẩn production, đo chi phí thật, rút ra bài học, **rồi destroy**.
**Thời gian:** 3 ngày — **có deadline cứng**
**Chi phí:** ~$8 nếu đúng 3 ngày. ~$75/tháng nếu quên tắt.
**Kết quả:** hiểu chính xác cái giá của "làm đúng chuẩn", bằng tiền của mình.

---

## 8.0. Quy tắc của phase này

> ⚠️ **ĐẶT LỊCH NHẮC DESTROY NGAY BÂY GIỜ**, trước khi gõ dòng Terraform đầu tiên.
>
> Điện thoại → nhắc nhở → 3 ngày nữa → "terraform destroy prod-like".
>
> Phase này tốn $0.90/ngày. Quên 1 tháng là $27 — hơn 13% ngân sách còn lại, đổi lấy con số không.

Phase 8 **không thay thế** Learning Mode. Nó là môi trường thứ hai, state riêng, chạy song song vài ngày để so sánh.

---

## 8.1. Khác biệt so với Learning Mode

| | Learning (Phase 3–7) | Production-like (Phase 8) |
|---|---|---|
| Laravel API | Chạy local | ECS Fargate sau ALB |
| Mạng | Public subnet | Private subnet + NAT Gateway |
| RDS | `publicly_accessible = true` | `false`, private subnet |
| HTTPS | Không | ACM certificate |
| Secrets | Parameter Store | Parameter Store (giữ nguyên) |
| Deploy | `build-push.sh` thủ công | GitHub Actions + OIDC |
| Chi phí | ~$15/tháng | ~$75/tháng |

**Ba thứ mới tốn tiền:**

| | Giá | 3 ngày |
|---|---:|---:|
| NAT Gateway | $32.4/tháng | $3.2 |
| ALB | $16.4/tháng | $1.6 |
| API tasks (2 × Fargate) | $18/tháng | $1.8 |
| **Tổng thêm** | **~$67/tháng** | **~$6.6** |

---

## 8.2. State tách biệt — bắt buộc

`envs/prod-like/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket  = "taskflow-tfstate-123456789012"
    key     = "prod-like/terraform.tfstate"    # KHÁC "learning/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "taskflow"
      Environment = "prod-like"     # tách chi phí trong Cost Explorer
      ManagedBy   = "terraform"
      DeleteAfter = "2027-01-10"    # ghi hạn ngay trên tag
    }
  }
}
```

> 💡 State key khác nhau = hai hạ tầng hoàn toàn độc lập. `terraform destroy` trong `prod-like/` **không thể** chạm vào Learning Mode. Đây là lý do phải tách ngay từ đầu.

---

## 8.3. Mạng private + NAT Gateway

> 💡 **NAT Gateway là gì:** tài nguyên ở private subnet không có đường ra Internet. NAT Gateway (đặt ở public subnet) cho phép chúng **gọi ra** mà không ai **gọi vào** được. Đây là mô hình chuẩn production.
>
> **Vì sao đắt:** $0.045/giờ (~$32/tháng) **cộng** $0.045/GB dữ liệu qua nó. Tính theo giờ kể cả khi không có traffic.
>
> **Vì sao Interface Endpoint không rẻ hơn:** để worker ở private subnet gọi được AWS API cần tối thiểu 4 endpoint (`sqs`, `ecr.api`, `ecr.dkr`, `logs`) × $7.2/tháng = **$28.8** — gần bằng NAT mà kém linh hoạt hơn. Đây là bẫy nhiều người mắc. Chỉ **S3 Gateway Endpoint là miễn phí**.

```hcl
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

resource "aws_eip" "nat" { domain = "vpc" }

# MỘT NAT Gateway cho cả 2 AZ.
# Production thật cần 2 (mỗi AZ một cái) để chịu lỗi, nhưng thế là $65/tháng.
# Ta chấp nhận single point of failure để tiết kiệm — và đó cũng là một bài học
# về đánh đổi: high availability có giá cụ thể.
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}
```

---

## 8.4. ALB và HTTPS

> 💡 **ALB (Application Load Balancer)** phân phối HTTP request tới nhiều task, kiểm tra sức khỏe (health check) và tự loại task hỏng ra khỏi vòng quay. Nó cũng là nơi kết thúc TLS — task chỉ nói HTTP thường ở phía sau.
>
> **Target group** là danh sách đích. ECS tự đăng ký/hủy đăng ký task vào target group khi scale.

```hcl
resource "aws_lb" "main" {
  name               = "taskflow-alb"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "api" {
  name        = "taskflow-api-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"          # BẮT BUỘC với Fargate (awsvpc mode)

  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    matcher             = "200"
  }

  # Chờ request đang xử lý xong rồi mới gỡ task. Mặc định 300s là quá lâu cho deploy.
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.main.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# HTTP -> HTTPS
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443", protocol = "HTTPS", status_code = "HTTP_301" }
  }
}
```

> 💡 **ACM certificate miễn phí** nhưng cần một domain bạn sở hữu để verify. Không có domain thì bỏ HTTPS, chỉ dùng listener HTTP port 80 — vẫn học được ALB, chỉ thiếu phần TLS. Đừng mua domain chỉ để làm bài tập này ($12/năm, không đáng).

Nhớ thêm endpoint health check trong Laravel:

```php
Route::get('/health', fn () => response()->json(['status' => 'ok']));
```

Không có nó, ALB đánh dấu mọi task là unhealthy và deploy sẽ treo vô hạn — lỗi phổ biến nhất khi lần đầu dùng ALB.

---

## 8.5. Migration khi RDS private

Learning Mode chạy `php artisan migrate` từ local được. Giờ RDS ở private subnet, không kết nối từ ngoài được nữa.

`scripts/migrate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

aws ecs run-task \
  --cluster taskflow-prod \
  --task-definition taskflow-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={
      subnets=[$PRIVATE_SUBNET_1,$PRIVATE_SUBNET_2],
      securityGroups=[$WORKER_SG],
      assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{
      "name":"app",
      "command":["php","artisan","migrate","--force"]}]}' \
  --profile taskflow
```

> 💡 **Vì sao one-off task chứ không chạy trong entrypoint:** nếu migration nằm trong entrypoint, 2 task khởi động cùng lúc sẽ chạy đua và có thể làm hỏng schema. One-off task đảm bảo chạy đúng một lần.

---

## 8.6. CI/CD với OIDC

> 💡 **OIDC là gì và vì sao quan trọng:** cách cũ là tạo IAM user, lấy access key, dán vào GitHub Secrets. Key đó tồn tại vĩnh viễn — lộ là toi.
>
> Với OIDC, GitHub Actions xuất trình một token có chữ ký chứng minh "tôi là workflow của repo X, branch Y". AWS tin token đó và cấp credentials **tạm thời 1 giờ**. **Không có secret nào để rò rỉ.** Đây là cách làm đúng hiện nay.

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "taskflow-github-actions"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        # Giới hạn ĐÚNG repo và ĐÚNG branch.
        # Thiếu điều kiện này thì BẤT KỲ repo GitHub nào cũng assume được role.
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:USERNAME/aws-infrastructure:ref:refs/heads/main"
        }
      }
    }]
  })
}
```

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

permissions:
  id-token: write      # BẮT BUỘC cho OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/taskflow-github-actions
          aws-region: us-east-1

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr

      - uses: docker/setup-buildx-action@v3

      - name: Build và push
        run: |
          TAG=${GITHUB_SHA::7}
          docker buildx build --platform linux/arm64 \
            -f backend/Dockerfile.worker \
            -t ${{ steps.ecr.outputs.registry }}/taskflow-worker:$TAG \
            --push backend/

      - name: Deploy
        run: |
          aws ecs update-service --cluster taskflow-prod \
            --service taskflow-worker --force-new-deployment
```

---

## 8.7. Đo đạc và so sánh — mục đích thật của phase này

Chạy 3 ngày. Mỗi ngày ghi vào `docs/learning-journal.md`:

### Ngày 1 — Dựng và đo
```bash
terraform apply
./scripts/migrate.sh
# Chạy load test 500 job giống Phase 4
```
Ghi lại: thời gian dựng, số resource Terraform tạo, có gì hỏng.

### Ngày 2 — So sánh vận hành
- Cùng bài load test, so sánh thời gian xử lý với Learning Mode
- Deploy một thay đổi nhỏ qua CI/CD, đo thời gian từ `git push` tới khi chạy
- Thử tắt 1 task xem ALB có loại nó ra không

### Ngày 3 — So sánh chi phí và destroy

```bash
aws ce get-cost-and-usage \
  --time-period Start=2027-01-07,End=2027-01-10 \
  --granularity DAILY --metrics UnblendedCost \
  --group-by Type=TAG,Key=Environment \
  --profile taskflow
```

Điền bảng này — **đây là sản phẩm giá trị nhất của Phase 8**:

| Hạng mục | Learning | Prod-like | Chênh |
|---|---:|---:|---:|
| Chi phí/ngày | | | |
| Chi phí/tháng ước tính | | | |
| Thời gian deploy | | | |
| Thời gian dựng lại từ 0 | | | |
| Số resource Terraform | | | |
| Job/phút ở 10 worker | | | |

Câu hỏi phải trả lời được: **"Chênh lệch $60/tháng mua được những gì, và khi nào thì đáng?"**

Rồi:

```bash
cd infrastructure/terraform/envs/prod-like
terraform destroy
```

Kiểm tra sạch chưa:

```bash
aws ec2 describe-nat-gateways --filter Name=state,Values=available --profile taskflow
aws elbv2 describe-load-balancers --profile taskflow
aws rds describe-db-instances --profile taskflow
```

NAT Gateway và ALB phải **rỗng**. Đây là hai thứ đắt nhất — kiểm tra bằng mắt, đừng tin `terraform destroy` một cách mù quáng.

---

## 8.8. Tổng kết dự án

Sau khi destroy, viết `docs/learning-journal.md` phần cuối:

1. **Chi phí thực tế toàn dự án** so với dự toán $100–130
2. **Ba thứ đắt nhất** và cách giảm
3. **Ba lỗi tốn nhiều thời gian nhất** và cách phát hiện
4. **Ba khái niệm khó nhất** — với tôi dự đoán là: bẫy chia-cho-0 khi scale-to-zero, receipt handle vs message ID, và vì sao Alarm không gọi Lambda trực tiếp
5. **Nếu làm lại thì làm khác gì**

Giữ lại Learning Mode nếu còn credits — nó rẻ và bạn có thể tiếp tục thử các mục ở phần "Hướng mở rộng".

---

## Definition of Done — Phase 8

- [ ] State `prod-like` tách biệt hoàn toàn khỏi `learning`
- [ ] Laravel API chạy trên ECS sau ALB, truy cập được từ Internet
- [ ] RDS ở private subnet, `publicly_accessible = false`
- [ ] Migration chạy được bằng `ecs run-task`
- [ ] CI/CD deploy được từ `git push`, dùng **OIDC không access key**
- [ ] React deploy lên S3 + CloudFront, SPA fallback hoạt động (xem [frontend-guide.md](frontend-guide.md) mục 6)
- [ ] CORS cấu hình đúng, đăng nhập được từ domain CloudFront
- [ ] Đã điền bảng so sánh chi phí ở 8.7
- [ ] **`terraform destroy` đã chạy**
- [ ] Đã xác minh không còn NAT Gateway và ALB nào
- [ ] Learning journal có phần tổng kết
- [ ] Tổng chi tiêu toàn dự án < $130

---

## Sau khi xong

Còn credits và còn thời gian? Những thứ đáng thử tiếp, xếp theo tỷ lệ học được / chi phí:

1. **Fargate Spot** — rẻ hơn ~70%. Workload này chịu được gián đoạn vì đã có SIGTERM handling và SQS redrive. Đây là phần thưởng trực tiếp cho công sức bỏ ra ở Phase 4.
2. **Transactional outbox** — giải quyết triệt để dual-write ở Phase 1.
3. **Queue theo priority** — thêm `taskflow-jobs-high`, worker poll queue cao trước.
4. **X-Ray tracing** — theo dõi một request xuyên qua API → SQS → worker → Lambda.
5. **DynamoDB cho idempotency key** — on-demand, gần như miễn phí ở quy mô này.

Mỗi cái là 1–2 ngày và đều dùng lại được toàn bộ nền tảng đã dựng.
