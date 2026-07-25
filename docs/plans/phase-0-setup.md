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
4. Lưu mật khẩu root vào password manager. Từ giờ chỉ dùng root cho: đổi payment method, đổi support plan, đóng tài khoản, và bật IAM billing access (bước 4).

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

> 💡 **Giải thích:** AWS chia thành ~30 **region** (vùng địa lý) độc lập. Tài nguyên tạo ở region này **không hiện ra** khi bạn đang xem region khác. Đây là cách mất tiền âm thầm phổ biến nhất: lỡ tay tạo RDS ở Singapore trong khi bạn luôn mở console ở Virginia, và nó chạy 6 tháng không ai biết. Policy này chặn tận gốc.

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
        "aws:RequestedRegion": ["us-east-1"]
      }
    }
  }]
}
```

`NotAction` liệt kê các dịch vụ **global** (không thuộc region nào) — phải loại trừ, nếu không bạn không tạo nổi cả IAM role.

Chỉ một region duy nhất trong danh sách, vì dự án chọn `us-east-1` — cũng chính là nơi metric billing của AWS tồn tại, nên alarm chi phí ở Phase 7 tạo được ngay trong region này, không cần mở thêm ngoại lệ.

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
        "es:CreateDomain", "es:CreateElasticsearchDomain",
        "aoss:CreateCollection",
        "sagemaker:CreateNotebookInstance", "sagemaker:CreateEndpoint",
        "fsx:CreateFileSystem",
        "directconnect:*",
        "network-firewall:CreateFirewall",
        "transfer:CreateServer",
        "route53domains:RegisterDomain",
        "elasticache:CreateCacheCluster",
        "elasticache:CreateReplicationGroup",
        "elasticache:CreateServerlessCache",
        "rds:CreateDBCluster",
        "ec2:CreateFleet",
        "ec2:RequestSpotInstances"
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

Một EKS cluster là $73/tháng chỉ riêng control plane. MSK rẻ nhất ~$80/tháng. Hai cái đó thôi đã xóa sổ credits. `rds:CreateDBCluster` và `ec2:CreateFleet` bị chặn thẳng vì chúng là đường đi vòng — Aurora Serverless v2 không có instance class nên statement `OnlySmallRds` không chặn được nó.

> ⚠️ Giữ nguyên `Resource` của `OnlySmallInstances` là `arn:aws:ec2:*:*:instance/*`. Đổi thành `"*"` sẽ chặn luôn cả `t3.micro`.

Attach cả hai policy vào user `taskflow-admin`.

> ⚠️ Guardrail này chặn cả ElastiCache. Đúng với thiết kế (dự án dùng database lock thay Redis). Nếu sau này muốn thử ElastiCache thì nhớ gỡ dòng đó — nếu không sẽ mất thời gian debug một `AccessDenied` do chính mình đặt ra.

---

## 0.3. Kiểm soát chi phí

### Bước 4 — Bật Cost Explorer

1. **Đăng nhập root** → **Account** → **IAM user and role access to billing information** → **Edit** → tick **Activate IAM access** → **Update**. Chỉ root mở được công tắc này; không bật thì `taskflow-admin` gặp `Access denied` ở mọi trang Billing (bước 4–7).
2. Đăng nhập lại `taskflow-admin` → **Billing and Cost Management → Cost Explorer → Enable.**

> 💡 **Giải thích:** Cost Explorer là công cụ xem chi tiêu theo ngày/dịch vụ/tag. Lần đầu bật mất **tới 24 giờ** mới có dữ liệu, nên làm ngay hôm nay để mai đã dùng được.

### Bước 5 — Budgets

> 💡 **Giải thích:** AWS Budgets gửi email khi chi tiêu vượt ngưỡng bạn đặt. Nó **không tự động chặn** gì cả — chỉ cảnh báo. Nhưng cảnh báo sớm là đủ, vì gần như mọi sự cố chi phí đều là "thứ gì đó chạy 24/7 mà mình quên".

> ⚠️ **BẪY QUAN TRỌNG NHẤT CỦA PHASE 0:** Budget mặc định tính chi phí **sau khi trừ credits**. Bạn đang có $200 credits → chi tiêu hiển thị luôn là **$0** → budget **không bao giờ bắn** cho tới khi credits cạn sạch, đúng lúc quá muộn.
>
> Cách chặn: ở **Budget scope** chọn **Filter specific AWS cost dimensions** → **Dimension** = `Charge type` → chỉ tick `Usage` và `Tax`. Loại `Credit`/`Refund` ra khỏi phạm vi tính, budget sẽ theo dõi chi tiêu gộp — chính là tốc độ đốt credits.

**Budgets → Create budget → chọn `Customize (advanced)`**, không dùng `Use a template`. Template không cho bỏ tick Credits.

AWS miễn phí **2 budget**, mỗi budget hỗ trợ **5 ngưỡng cảnh báo**. Vậy 2 budget là đủ.

**Budget 1 — `taskflow-monthly-gross`**

```
Type    : Cost budget
Period  : Monthly, recurring
Amount  : $30
Scope   : Filter specific AWS cost dimensions → Add filter → Charge type → Values: Usage, Tax
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
Period  : Custom, 25/07/2026 → 22/01/2027
Amount  : $80
Scope   : Filter specific AWS cost dimensions → Add filter → Charge type → Values: Usage, Tax
```

| Ngưỡng | Số tiền | Loại | Ý nghĩa |
|---:|---:|---|---|
| 25% | $20 | Actual | Đang đi đúng hướng |
| 50% | $40 | Actual | Quá nửa dự toán, còn 2–3 phase |
| 75% | $60 | Actual | Kiểm tra có gì chạy mà quên tắt |
| 90% | $72 | Actual | Dừng tạo mới, destroy thứ không dùng |

Budget này không reset mỗi tháng — nó trả lời "đã đốt bao nhiêu trên cả dự án". Đặt $80 vì dự toán toàn bộ Phase 0–8 là ~$50; vẫn còn $120 credits đệm phía sau.

### Bước 6 — Cost Anomaly Detection

AWS tự tạo sẵn monitor `Default-Services-Monitor` (kiểu AWS services) cho account mới. Mỗi account chỉ được 1 monitor loại này, nên **không cần Create monitor** — lựa chọn đó sẽ bị khóa. Việc cần làm là gắn cảnh báo cho nó.

**Billing and Cost Management → Cost Anomaly Detection → Alert subscriptions → Create subscription:**

```
Subscription name  : taskflow-anomaly-alert
Alerting frequency : Daily summaries
Alert recipients   : <email của bạn>
Threshold          : $5 — amount above expected spend
Cost monitors      : tick Default-Services-Monitor
```

Miễn phí. Nó bắt được thứ budget theo tháng bỏ sót — ví dụ một dịch vụ mới đột nhiên xuất hiện giữa tháng.

### Bước 7 — Cost Allocation Tags

**Billing and Cost Management → Cost Allocation Tags** → tìm `Project` → tick → **Activate**.

**Hôm nay chưa làm được, và đó là bình thường.** Danh sách chỉ hiện tag nào đã có ít nhất một tài nguyên mang nó, mà Phase 0 chưa tạo tài nguyên nào. Account mới chỉ thấy `Name` và `aws:createdBy` — AWS tự sinh, cứ để `Inactive`, không cần làm gì.

`Project` sẽ xuất hiện sau khi Terraform ở Phase 3 tạo tài nguyên đầu tiên. **Quay lại activate ngay lúc đó.**

> 💡 **Giải thích:** Tag là cặp key-value gắn lên tài nguyên. Sau khi activate, Cost Explorer cho phép lọc chi phí theo tag. **Tag không hồi tố** — chi phí phát sinh trước lúc activate sẽ không được phân loại, nên activate càng sớm càng tốt.

---

## 0.4. Chốt region

Chọn **một** region và không bao giờ đổi:

| Region | Ưu | Nhược |
|---|---|---|
| `ap-southeast-1` (Singapore) | Gần VN, ping ~30–50ms | Đắt hơn us-east-1 ~10–20% |
| `us-east-1` (Virginia) | Rẻ nhất, có mọi dịch vụ sớm nhất, là nơi duy nhất có metric billing | Ping ~250ms |

**Dự án này dùng `us-east-1`** — toàn bộ tài liệu đã theo region đó. Với dự án học tập, latency không quan trọng: bạn không phục vụ người dùng thật, và 250ms chỉ ảnh hưởng lúc bấm nút trên console hay gọi API từ máy local. Bù lại được giá rẻ nhất và không phải mở ngoại lệ region cho alarm billing ở Phase 7.

**Ghi lại lựa chọn:**

```
Region đã chọn: us-east-1
AWS Account ID: 621646470792
```

Account ID lấy ở góc trên phải console. Bạn sẽ cần nó nhiều lần (tên S3 bucket, ARN).

---

## 0.5. Cài đặt máy local

### Bước 8 — Công cụ

| Công cụ | Phiên bản | Kiểm tra |
|---|---|---|
| PHP | 8.1+ | `php -v` |
| Composer | 2.x | `composer -V` |
| Node.js | 20+ | `node -v` |
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
# Default region name   : us-east-1
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
# Mong đợi: UnauthorizedOperation ... explicit deny in an identity-based policy:
#           arn:aws:iam::<ACCOUNT_ID>:policy/taskflow-guardrail-region
```

Nếu lệnh này **thành công**, guardrail chưa được attach đúng. Quay lại bước 3.

Kiểm tra `taskflow-guardrail-expensive`. `--dry-run` đánh giá quyền rồi dừng trước khi tạo tài nguyên — miễn phí, không tạo gì:

```bash
AMI=$(aws ssm get-parameter --profile taskflow --region us-east-1 \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)

# Kỳ vọng: DryRunOperation  (= có quyền)
aws ec2 run-instances --profile taskflow --region us-east-1 \
  --image-id $AMI --instance-type t3.micro --dry-run

# Kỳ vọng: UnauthorizedOperation  (= guardrail chặn)
aws ec2 run-instances --profile taskflow --region us-east-1 \
  --image-id $AMI --instance-type m5.large --dry-run
```

Lệnh `t3.micro` quan trọng hơn lệnh `m5.large`: nó chứng minh guardrail **không chặn oan** thứ bạn thực sự cần dùng.

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
- [ ] `aws ec2 describe-vpcs --region eu-west-1` trả về **UnauthorizedOperation** kèm `explicit deny ... taskflow-guardrail-region`
- [ ] `run-instances --instance-type t3.micro --dry-run` trả về **DryRunOperation**
- [ ] `run-instances --instance-type m5.large --dry-run` trả về **UnauthorizedOperation**
- [ ] `aws sts get-caller-identity` hiện đúng `taskflow-admin`
- [ ] Budget `taskflow-monthly-gross` $30, **Charge type = Usage + Tax**, 5 ngưỡng
- [ ] Budget `taskflow-total-credits` $80 hết hạn 22/01/2027, **Charge type = Usage + Tax**
- [ ] Cost Anomaly Detection bật
- [ ] Cost Explorer bật
- [ ] Region đã chốt và ghi lại
- [ ] Account ID đã ghi lại
- [ ] `terraform -v`, `aws --version`, `docker -v` đều chạy
- [ ] `.gitignore` gốc có `*.tfstate`
- [ ] Đã nhận **email test** từ Budget (AWS gửi xác nhận subscription — phải bấm confirm)

> Điều cuối quan trọng: nếu chưa confirm email subscription thì cảnh báo sẽ không bao giờ tới. Kiểm tra hộp thư ngay.

**→ Tiếp theo: [Phase 1 — Local](phase-1-local.md)**
