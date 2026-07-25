# Phase 0 — Chuẩn bị tài khoản và công cụ

**Mục tiêu:** dựng hàng rào an toàn về chi phí, và chuẩn bị máy local. Chưa tạo tài nguyên AWS nào tốn tiền.
**Thời gian:** 1 buổi (~3 giờ)
**Chi phí:** $0
**Kết quả:** account AWS an toàn, CLI chạy được, repo có cấu trúc thư mục.

---

## 0.1. Vì sao có phase này

Bạn có $200 credits, hết hạn 22/01/2027. Nếu bỏ qua phase này, kịch bản điển hình là: tháng thứ 2 phát hiện credits còn 40%, không biết tiền đi đâu, không dám xóa gì vì sợ hỏng, và dự án chết.

Phase 0 mất 3 giờ để tránh điều đó.

---

## 0.2. Bảo mật tài khoản

### Bước 1 — Khóa root account

> 💡 **Giải thích:** "root" là email bạn dùng đăng ký AWS. Nó có toàn quyền tuyệt đối và **không thể bị giới hạn** bằng bất kỳ chính sách nào — kể cả bạn tự viết policy chặn cũng không có tác dụng với root. Nó cũng có quyền đóng tài khoản và đổi phương thức thanh toán. Vì vậy nguyên tắc phổ quát là: đăng nhập root đúng vài lần trong đời tài khoản, còn lại dùng IAM user.

1. Đăng nhập AWS Console bằng root.
2. Vào **IAM → Dashboard → Root user → Enable MFA**. Dùng app authenticator (Google Authenticator, Authy, 1Password).
3. Vào **IAM → Dashboard → Root access keys** — nếu có access key nào, **xóa hết**. Root không bao giờ cần access key.
4. Lưu mật khẩu root vào password manager. Từ giờ chỉ dùng root cho: đổi payment method, đổi support plan, đóng tài khoản.

### Bước 2 — Tạo IAM user cho công việc hằng ngày

> 💡 **Giải thích — IAM là gì:** IAM (Identity and Access Management) là hệ thống phân quyền của AWS. Ba khái niệm bạn sẽ gặp suốt dự án:
> - **User** — một danh tính cho con người, có mật khẩu và/hoặc access key.
> - **Role** — một danh tính cho *máy* (ECS task, Lambda function). Không có mật khẩu; AWS tự cấp credentials tạm thời khi máy cần. Đây là cách an toàn nhất và ta sẽ dùng từ Phase 3.
> - **Policy** — văn bản JSON mô tả "được phép/bị cấm làm gì trên tài nguyên nào".

1. **IAM → Users → Create user**, tên `taskflow-admin`.
2. Tick **Provide user access to the AWS Management Console**, đặt mật khẩu.
3. **Attach policies directly → `AdministratorAccess`**.

   > Nghe có vẻ trái với least privilege, nhưng: bạn là người duy nhất trong account và cần tạo VPC, ECS, IAM role, RDS... Cắt quyền ở đây chỉ tạo ra hàng giờ debug `AccessDenied` thay vì học AWS. Least privilege sẽ áp dụng nghiêm ngặt cho **service role** (Phase 3) — đó mới là chỗ nó có ý nghĩa. Cái ta làm thêm ở đây là guardrail chặn thứ đắt, xem bước 3.

4. Tạo xong → bật **MFA** cho user này.
5. **Security credentials → Create access key** → chọn "Command Line Interface (CLI)". Lưu lại `Access key ID` và `Secret access key`.
6. Đăng xuất root, đăng nhập lại bằng `taskflow-admin`. Từ giờ chỉ dùng user này.

### Bước 3 — Guardrail policy

Hai policy `Deny` để chặn những cách mất tiền phổ biến nhất. `Deny` trong IAM luôn thắng `Allow`, nên chúng có tác dụng kể cả khi user có `AdministratorAccess`.

**IAM → Policies → Create policy → JSON.**

#### Policy `taskflow-guardrail-region`

> 💡 **Giải thích:** AWS chia thành ~30 **region** (vùng địa lý) độc lập. Tài nguyên tạo ở region này **không hiện ra** khi bạn đang xem region khác. Đây là cách mất tiền âm thầm phổ biến nhất: lỡ tay tạo RDS ở Virginia trong khi bạn luôn mở console ở Singapore, và nó chạy 6 tháng không ai biết. Policy này chặn tận gốc.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyOutsideAllowedRegions",
    "Effect": "Deny",
    "NotAction": [
      "iam:*", "sts:*", "organizations:*", "account:*",
      "cloudfront:*", "route53:*", "route53domains:*",
      "support:*", "budgets:*", "ce:*", "cur:*",
      "health:*", "globalaccelerator:*", "waf:*",
      "s3:ListAllMyBuckets", "s3:GetBucketLocation"
    ],
    "Resource": "*",
    "Condition": {
      "StringNotEquals": {
        "aws:RequestedRegion": ["ap-southeast-1", "us-east-1"]
      }
    }
  }]
}
```

`NotAction` liệt kê các dịch vụ **global** (không thuộc region nào) — phải loại trừ, nếu không bạn không tạo nổi cả IAM role.

Vì sao vẫn cho `us-east-1` dù chọn Singapore: metric billing của AWS **chỉ tồn tại ở us-east-1**, nên alarm cảnh báo chi phí ở Phase 7 bắt buộc phải tạo ở đó.

#### Policy `taskflow-guardrail-expensive`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyExpensiveServices",
      "Effect": "Deny",
      "Action": [
        "eks:CreateCluster",
        "kafka:CreateCluster", "kafka:CreateClusterV2",
        "redshift:CreateCluster",
        "elasticmapreduce:RunJobFlow",
        "es:CreateDomain", "opensearch:CreateDomain",
        "sagemaker:CreateNotebookInstance", "sagemaker:CreateEndpoint",
        "fsx:CreateFileSystem",
        "directconnect:*",
        "network-firewall:CreateFirewall",
        "transfer:CreateServer",
        "route53domains:RegisterDomain",
        "elasticache:CreateCacheCluster",
        "elasticache:CreateReplicationGroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "OnlySmallInstances",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringNotLike": {
          "ec2:InstanceType": ["t2.micro", "t3.micro", "t3.small", "t4g.micro", "t4g.small"]
        }
      }
    },
    {
      "Sid": "OnlySmallRds",
      "Effect": "Deny",
      "Action": ["rds:CreateDBInstance", "rds:ModifyDBInstance"],
      "Resource": "*",
      "Condition": {
        "StringNotLike": {
          "rds:DatabaseClass": ["db.t3.micro", "db.t4g.micro", "db.t4g.small"]
        }
      }
    }
  ]
}
```

Một EKS cluster là $73/tháng chỉ riêng control plane. MSK rẻ nhất ~$80/tháng. Hai cái đó thôi đã xóa sổ credits.

Attach cả hai policy vào user `taskflow-admin`.

> ⚠️ Guardrail này chặn cả ElastiCache. Đúng với thiết kế (dự án dùng database lock thay Redis). Nếu sau này muốn thử ElastiCache thì nhớ gỡ dòng đó — nếu không sẽ mất thời gian debug một `AccessDenied` do chính mình đặt ra.

---

## 0.3. Kiểm soát chi phí

### Bước 4 — Bật Cost Explorer

**Billing and Cost Management → Cost Explorer → Enable.**

> 💡 **Giải thích:** Cost Explorer là công cụ xem chi tiêu theo ngày/dịch vụ/tag. Lần đầu bật mất **tới 24 giờ** mới có dữ liệu, nên làm ngay hôm nay để mai đã dùng được.

### Bước 5 — Budgets

> 💡 **Giải thích:** AWS Budgets gửi email khi chi tiêu vượt ngưỡng bạn đặt. Nó **không tự động chặn** gì cả — chỉ cảnh báo. Nhưng cảnh báo sớm là đủ, vì gần như mọi sự cố chi phí đều là "thứ gì đó chạy 24/7 mà mình quên".

> ⚠️ **BẪY QUAN TRỌNG NHẤT CỦA PHASE 0:** Budget mặc định tính chi phí **sau khi trừ credits**. Bạn đang có $200 credits → chi tiêu hiển thị luôn là **$0** → budget **không bao giờ bắn** cho tới khi credits cạn sạch, đúng lúc quá muộn.
>
> Khi tạo budget, mở **Advanced options** và **BỎ TICK "Credits"** (và "Refunds"). Khi đó budget theo dõi chi tiêu gộp — chính là tốc độ đốt credits.

AWS miễn phí **2 budget**, mỗi budget hỗ trợ **5 ngưỡng cảnh báo**. Vậy 2 budget là đủ.

**Budget 1 — `taskflow-monthly-gross`**

```
Type    : Cost budget
Period  : Monthly, recurring
Amount  : $30
Advanced: BỎ TICK Credits, Refunds
Filter  : (để trống — theo dõi toàn account)
```

| Ngưỡng | Số tiền | Loại | Ý nghĩa |
|---:|---:|---|---|
| 10% | $3 | Actual | Bắt đầu có chi tiêu, bình thường từ Phase 3 |
| 30% | $9 | Actual | Đúng dự toán |
| 50% | $15 | Actual | Giới hạn trên của dự toán |
| 80% | $24 | Actual | Mở Cost Explorer kiểm tra ngay |
| 100% | $30 | Forecasted | Dự báo vượt — điều tra trong ngày |

**Budget 2 — `taskflow-total-credits`**

```
Type    : Cost budget
Period  : Expiring, 25/07/2026 → 22/01/2027
Amount  : $200
Alerts  : 25% ($50) · 50% ($100) · 75% ($150) · 90% ($180)
Advanced: BỎ TICK Credits
```

Budget này không reset mỗi tháng — nó trả lời "còn bao nhiêu credits để học tiếp".

### Bước 6 — Cost Anomaly Detection

**Billing → Cost Anomaly Detection → Create monitor**, kiểu **AWS services**, alert email khi lệch > $5.

Miễn phí. Nó bắt được thứ budget theo tháng bỏ sót — ví dụ một dịch vụ mới đột nhiên xuất hiện giữa tháng.

### Bước 7 — Cost Allocation Tags

**Billing → Cost allocation tags → User-defined** → tìm `Project` → **Activate**.

> 💡 **Giải thích:** Tag là cặp key-value gắn lên tài nguyên. Sau khi activate, Cost Explorer cho phép lọc chi phí theo tag. **Tag không hồi tố** — tài nguyên tạo trước khi activate sẽ không được phân loại. Đó là lý do phải làm ở Phase 0.
>
> Tag sẽ chỉ xuất hiện trong danh sách sau khi có ít nhất một tài nguyên mang tag đó. Nếu chưa thấy `Project`, quay lại bước này sau Phase 2.

---

## 0.4. Chốt region

Chọn **một** region và không bao giờ đổi:

| Region | Ưu | Nhược |
|---|---|---|
| `ap-southeast-1` (Singapore) | Gần VN, ping ~30–50ms | Đắt hơn us-east-1 ~10–20% |
| `us-east-1` (Virginia) | Rẻ nhất, có mọi dịch vụ sớm nhất | Ping ~250ms |

Với dự án học tập, latency không quan trọng bằng chi phí, nhưng chênh lệch 15% trên $100 chỉ là $15 — nên cứ chọn cái nào bạn thấy thoải mái. Tài liệu này dùng `ap-southeast-1` trong ví dụ.

**Ghi lại lựa chọn:**

```
Region đã chọn: ______________________
AWS Account ID: ______________________
```

Account ID lấy ở góc trên phải console. Bạn sẽ cần nó nhiều lần (tên S3 bucket, ARN).

---

## 0.5. Cài đặt máy local

### Bước 8 — Công cụ

| Công cụ | Phiên bản | Kiểm tra |
|---|---|---|
| PHP | 8.1+ | `php -v` |
| Composer | 2.x | `composer -V` |
| Node.js | 18+ | `node -v` |
| Docker Desktop | mới nhất | `docker -v` |
| AWS CLI | v2 | `aws --version` |
| Terraform | 1.6+ | `terraform -v` |

Cài AWS CLI v2 trên Windows:

```powershell
winget install Amazon.AWSCLI
```

Cài Terraform:

```powershell
winget install HashiCorp.Terraform
```

### Bước 9 — Cấu hình AWS CLI

```bash
aws configure --profile taskflow
# AWS Access Key ID     : (key của taskflow-admin)
# AWS Secret Access Key : (secret)
# Default region name   : ap-southeast-1
# Default output format : json
```

> 💡 **Giải thích — profile:** AWS CLI cho phép nhiều bộ credentials đặt tên khác nhau. Dùng profile riêng `taskflow` thay vì `default` để sau này nếu có account AWS khác thì không lẫn. Mọi lệnh trong tài liệu này đều có `--profile taskflow`.

Đặt biến môi trường cho tiện (thêm vào PowerShell profile):

```powershell
$env:AWS_PROFILE = "taskflow"
```

Kiểm tra:

```bash
aws sts get-caller-identity --profile taskflow
```

Kết quả phải hiện `arn:aws:iam::<ACCOUNT_ID>:user/taskflow-admin`. Nếu ra root thì bạn đang dùng nhầm credentials.

Kiểm tra guardrail có hoạt động không — lệnh này **phải bị từ chối**:

```bash
aws ec2 describe-vpcs --region eu-west-1 --profile taskflow
# Mong đợi: AccessDenied (vì eu-west-1 không nằm trong allowed regions)
```

Nếu lệnh này **thành công**, guardrail chưa được attach đúng. Quay lại bước 3.

---

## 0.6. Chuẩn bị repository

### Bước 10 — Cấu trúc thư mục

Repo hiện có `backend/` (Laravel 10) và `frontend/` (React + Vite). Tạo thêm:

```bash
mkdir -p infrastructure/terraform/modules
mkdir -p infrastructure/terraform/envs/learning
mkdir -p infrastructure/terraform/envs/prod-like
mkdir -p lambdas
mkdir -p scripts
```

### Bước 11 — File `.gitignore` gốc

Tạo `.gitignore` ở thư mục gốc:

```gitignore
# Terraform
**/.terraform/
*.tfstate
*.tfstate.*
*.tfvars
!*.tfvars.example
.terraform.lock.hcl

# AWS
.aws/
credentials

# Môi trường
.env
.env.*
!.env.example

# IDE / OS
.vscode/
.idea/
Thumbs.db
.DS_Store
```

> ⚠️ `*.tfstate` chứa **toàn bộ thông tin hạ tầng, kể cả mật khẩu database dạng plain text**. Commit nhầm file này là sự cố bảo mật thật. Phase 3 sẽ chuyển state lên S3 để tránh hẳn.

### Bước 12 — File nhật ký

```bash
touch docs/learning-journal.md
touch docs/cost-control.md
```

`docs/cost-control.md` — mỗi Chủ nhật ghi một dòng:

```markdown
| Tuần | Ngày | Chi tiêu tuần | Tích lũy | Ghi chú |
|---|---|---:|---:|---|
| 1 | 26/07/2026 | $0.00 | $0.00 | Phase 0 xong |
```

Nghe thủ công nhưng chính thói quen này mới giữ được ngân sách, không phải cấu hình.

---

## Definition of Done — Phase 0

Chỉ sang Phase 1 khi tick hết:

- [ ] Root có MFA, không còn access key
- [ ] IAM user `taskflow-admin` có MFA, `AdministratorAccess`
- [ ] 2 guardrail policy đã attach
- [ ] `aws ec2 describe-vpcs --region eu-west-1` trả về **AccessDenied**
- [ ] `aws sts get-caller-identity` hiện đúng `taskflow-admin`
- [ ] Budget `taskflow-monthly-gross` $30, **đã bỏ tick Credits**, 5 ngưỡng
- [ ] Budget `taskflow-total-credits` $200 hết hạn 22/01/2027, **đã bỏ tick Credits**
- [ ] Cost Anomaly Detection bật
- [ ] Cost Explorer bật
- [ ] Region đã chốt và ghi lại
- [ ] Account ID đã ghi lại
- [ ] `terraform -v`, `aws --version`, `docker -v` đều chạy
- [ ] `.gitignore` gốc có `*.tfstate`
- [ ] Đã nhận **email test** từ Budget (AWS gửi xác nhận subscription — phải bấm confirm)

> Điều cuối quan trọng: nếu chưa confirm email subscription thì cảnh báo sẽ không bao giờ tới. Kiểm tra hộp thư ngay.

**→ Tiếp theo: [Phase 1 — Local](phase-1-local.md)**
