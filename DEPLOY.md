# 웹에서 사용하기

이 프로그램은 Node.js 서버에서 실행됩니다. GitHub Pages 같은 정적 파일 호스팅만으로는 키움 API, 로그인, 자동매매 루프를 실행할 수 없습니다.

## Render 배포

[Render에 배포하기](https://render.com/deploy?repo=https://github.com/stun1012/kiwoom-autotrader)

1. 위 링크를 열고 Render에 로그인합니다.
2. 이 저장소의 `render.yaml`을 사용하는 Blueprint를 생성합니다. 무료 Web Service 한 개만 정의되어 있습니다.
3. 배포가 끝나면 서비스의 `https://…onrender.com` 주소를 엽니다.
4. Render 서비스의 **Environment**에서 자동 생성된 `DASHBOARD_PASSWORD` 값을 확인해 로그인합니다. 비밀번호를 GitHub 파일에 넣지 마세요.
5. 기본 가상 시세 모드에서 자동매매를 시험합니다.
6. 키움 시세 사용 시 Render의 환경변수에 `KIWOOM_APPKEY`, `KIWOOM_SECRETKEY`를 직접 저장하고 재배포합니다. 키 발급 환경에 따라 `KIWOOM_ENV`를 `mock` 또는 `production`으로 지정합니다. 계좌 주문 기능은 포함하지 않습니다.

처음에는 키움 키 없이 배포할 수 있습니다. 서버가 확인할 외부 주소는 Render가 제공하는 `RENDER_EXTERNAL_URL`을 자동 사용합니다. 사용자 지정 도메인으로 접속하려면 `PUBLIC_ORIGIN=https://실제도메인`을 지정하고 해당 주소를 사용하세요.

배포 전 엔진·로그인 테스트를 실행합니다. GitHub 변경 시 자동 재배포는 꺼 두었습니다. 계좌가 메모리에서 유지되므로 Render에서 수동 배포 전에 모의매매를 정지하고 CSV를 저장하세요.

### 무료 환경의 범위

- 무료 웹 서비스는 유휴 상태가 지속되면 중지될 수 있어 24시간 자동매매용이 아닙니다. 재접속 시 시작이 지연될 수 있습니다.
- 프로세스 재시작 시 가상 계좌는 초기화되고 실행 상태는 정지입니다. 자동 재개하지 않습니다.
- 로컬 파일은 영구 저장소가 아닙니다. 재배포/재시작 때 기록이 유실될 수 있으므로 CSV로 내려받으세요.
- 대시보드는 관리자 한 명을 위한 공유 계좌입니다. 접속자별 별도 계좌를 제공하지 않습니다.

상시 운영하려면 별도 유료 상시 서버와 영구 저장/복구 기능이 필요합니다. 현재 설정은 유료 서비스를 생성하지 않습니다.

## 다른 서버 / Docker

Node.js 24 이상에서 다음 환경변수와 `node server.mjs`를 사용합니다.

| 변수 | 의미 |
|---|---|
| `NODE_ENV` | 외부 서버에서는 `production` |
| `HOST` | 외부 서버에서는 `0.0.0.0` |
| `PORT` | 서버 포트. 기본 8765, 플랫폼 제공값 우선 |
| `PUBLIC_ORIGIN` | 접속할 HTTPS 기본 주소. 경로 없이 입력 |
| `DASHBOARD_PASSWORD` | 최소 16자의 긴 임의 비밀번호 |
| `KIWOOM_APPKEY`, `KIWOOM_SECRETKEY` | 키움 조회를 사용할 때만 입력 |
| `KIWOOM_ENV` | 기본 `mock`; `production`은 운영 시세 서버 |

Docker 이미지는 `docker build -t kiwoom-autotrader .`로 만들 수 있습니다. 컨테이너 앞에 HTTPS 프록시를 설정하고 프록시는 원래 Host 헤더를 유지해야 합니다. 환경변수는 서버의 보안 설정에서 주입합니다. `.dockerignore`는 실행 파일만 포함하므로 `.env`, 거래 기록, 다른 프로젝트 파일은 이미지에 들어가지 않습니다.

로그인은 12시간 유지되며 서버 재시작 시 만료됩니다. 로그아웃은 세션을 폐기하지만 매매를 정지하지 않습니다. 비밀번호 변경 후 서버를 재시작하면 모든 기존 세션이 만료됩니다. `/healthz`는 계좌 정보를 포함하지 않는 상태 확인 경로입니다.

## 근거 문서

- [Render 웹 서비스](https://render.com/docs/web-services)
- [Blueprint 설정](https://render.com/docs/blueprint-spec)
- [무료 서비스 제한](https://render.com/docs/free)
