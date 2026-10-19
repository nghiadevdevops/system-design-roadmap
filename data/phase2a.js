/* ===== Giai đoạn 2 · Khối xây dựng (tuần 6–9), phần 1: B1–B5 — LB/CDN, replication, sharding, NoSQL/storage engine, mô hình nhất quán (B6–B10 ở phase2a2.js) ===== */
window.LESSONS_B1 = [
{ id: 'B1', type: 'block', topic: 'scale', title: 'Load balancer, reverse proxy, API gateway, CDN', time: '120 phút',
  goal: 'Vẽ được lớp biên (edge) của một SaaS: chọn đúng L4/L7, thuật toán cân bằng, health check, nơi kết thúc TLS, cách CDN cache và purge; giải thích được vì sao gọi nội bộ không được đi qua hostname public.',
  md: `
### Vấn đề cần giải
Một máy chủ web xử lý được vài nghìn RPS cho request nhẹ, nhưng nó là single point of failure, không nâng cấp được lúc đang chạy, và client ở Tokyo gọi về Singapore vẫn tốn ~70 ms mỗi round trip dù server rảnh. Lớp biên tồn tại để giải quyết bốn việc tách bạch: **phân tải** (load balancer), **che topology và gom cross-cutting concern** (reverse proxy, API gateway), **đưa nội dung tới gần người dùng** (CDN) và **kết thúc TLS** ở một chỗ. Mỗi lớp thêm vào là thêm một hop (~0,5 ms trong DC) và một chỗ để cấu hình sai, nên phải biết lớp nào đang giải quyết vấn đề gì.

### Cốt lõi
#### L4 vs L7
| Tiêu chí | L4 (TCP/UDP) | L7 (HTTP/gRPC) |
|---|---|---|
| Nhìn thấy gì | IP, port, SYN/ACK | URL, header, cookie, method, body |
| Quyết định route | theo 5-tuple, hash IP | theo path, host, header, tenant |
| TLS | passthrough (không giải mã) hoặc terminate | terminate để đọc được header |
| Chi phí | rất rẻ, hàng triệu kết nối | parse HTTP, tốn CPU hơn 3–10 lần |
| Ví dụ | AWS NLB, HAProxy mode tcp, IPVS | AWS ALB, Nginx, Envoy, HAProxy mode http |
| Dùng khi | gRPC stream dài, giao thức lạ, cần IP client gốc | routing theo path, canary theo header, auth tại biên |

Thực tế hay xếp hai tầng: L4 (anycast/NLB) nhận kết nối, phía sau L7 (Nginx/Envoy) route theo path.

#### Thuật toán phân phối
- **Round robin / weighted RR**: đơn giản, giả định request đồng đều. Weighted khi máy khác cỡ.
- **Least connections / least response time**: tốt khi request dài ngắn lệch nhau (upload SBOM 50 MB vs GET health).
- **IP hash / cookie sticky**: giữ một client vào một backend. Chỉ nên dùng để tối ưu cache cục bộ, **không** dùng làm nơi giữ session state.
- **Consistent hash** theo key (tenant_id, URL): để cache cục bộ trúng; ít key đổi backend khi thêm máy.
- **Power of two choices**: chọn ngẫu nhiên 2 backend rồi lấy máy ít kết nối hơn; gần tối ưu với chi phí O(1), không cần trạng thái toàn cục. Envoy và nhiều mesh dùng mặc định.

#### Health check, connection draining, TLS termination
- **Active health check**: LB gọi [[/healthz]] mỗi 5–30 s, đánh dấu unhealthy sau 2–3 lần fail, healthy lại sau 2–3 lần pass. **Passive**: đếm lỗi 5xx/timeout từ traffic thật, phản ứng nhanh hơn.
- Phân biệt **liveness** (process còn sống) và **readiness** (đã kết nối DB/broker, cache đã ấm). LB chỉ nên route tới instance **ready**. Health check "trả 200 vô điều kiện" là lý do phổ biến khiến LB tiếp tục đổ traffic vào instance đã mất DB.
- **Connection draining** (deregistration delay): khi gỡ instance, LB ngừng gửi request mới nhưng chờ request đang chạy xong, 30–300 s (ALB mặc định 300 s). Thiếu bước này, mỗi lần deploy là một cụm 502. Ứng dụng phía sau phải xử lý SIGTERM: đóng listener, chờ in-flight, rồi thoát.
- **TLS termination** tại LB/proxy: một chỗ quản lý cert, backend nhận HTTP thuần hoặc TLS nội bộ (re-encrypt). TLS 1.3 handshake 1 RTT, TLS 1.2 là 2 RTT; session resumption giảm còn 0–1 RTT. Terminate ở biên cũng là nơi gắn [[X-Forwarded-For]], [[X-Forwarded-Proto]] mà backend phải tin có điều kiện (chỉ tin từ proxy đã biết).

#### Reverse proxy vs API gateway vs service mesh
| | Reverse proxy (Nginx, HAProxy) | API gateway (Kong, APISIX, AWS API GW) | Service mesh sidecar (Envoy/Istio, Linkerd) |
|---|---|---|---|
| Vị trí | trước một nhóm backend | biên của toàn bộ API public | cạnh **mỗi** service, cả chiều vào và ra |
| Việc chính | route, TLS, buffer, gzip, static | auth/JWT, rate limit, quota theo API key, routing theo version, aggregation, transform | mTLS, retry/timeout, circuit breaker, telemetry đồng nhất |
| Hiểu nghiệp vụ | không | một chút (tenant, plan) | không |
| Giá | gần như 0 | thêm hop, thêm chỗ cấu hình, dễ biến thành monolith | thêm 1–3 ms và CPU trên mỗi pod, vận hành control plane |
| Khi KHÔNG dùng | — | hệ có 2–3 service, chưa có khách API ngoài | dưới ~10 service, team chưa có người vận hành mesh |

Quy tắc: logic nghiệp vụ không bao giờ nằm ở gateway. Gateway chỉ làm việc **giống nhau cho mọi route**.

:::diagram
User[Người dùng] -> DNS[GSLB DNS / anycast] : resolve POP gần nhất
DNS -> CDN[CDN edge cache]
CDN -> L4[L4 LB / NLB] : cache miss
L4 -> GW[API gateway L7] : TLS terminate
GW -> AuthRL[Auth + rate limit]
GW -> API1[apiserver 1] : least conn
GW -> API2[apiserver 2]
API1 -> Mesh[Sidecar mTLS] : gọi nội bộ
Mesh -> Svc[Worker / service khác]
L4 -> Health[Health check /readyz] : 10 s
:::

#### CDN
- **Pull (origin pull)**: edge miss thì kéo từ origin và cache theo TTL. Đơn giản, phù hợp asset FE, ảnh, file export. **Push**: bạn upload sẵn lên CDN (video, release binary lớn); kiểm soát tốt nhưng phải tự quản vòng đời.
- **Cache key** mặc định = host + path + query. Thêm header vào key qua [[Vary]] (ví dụ [[Vary: Accept-Encoding]]). Cache key quá rộng (gồm mọi query param) → hit ratio thấp; quá hẹp → trả nhầm nội dung giữa người dùng.
- **TTL và invalidation**: purge lan truyền mất vài giây đến vài phút và nhiều CDN tính phí/giới hạn. Chiến lược chuẩn: **asset bất biến với tên có hash** ([[app.3f9a1c.js]], [[Cache-Control: public, max-age=31536000, immutable]]) và HTML TTL ngắn hoặc [[no-cache]] để luôn revalidate. Purge chỉ là đường cứu hoả.
- **Cache-Control**: [[max-age]] (trình duyệt), [[s-maxage]] (shared cache/CDN), [[private]] (không cho shared cache giữ), [[no-store]] (không ghi gì), [[no-cache]] (giữ nhưng phải hỏi lại), [[stale-while-revalidate=60]] (trả bản cũ trong lúc làm mới nền).
- **ETag / If-None-Match** và [[Last-Modified / If-Modified-Since]]: server trả [[304 Not Modified]] không body; tiết kiệm băng thông nhưng vẫn tốn một round trip và một lần tính ETag.
- **Edge compute** (Cloudflare Workers, Lambda@Edge, Fastly Compute): rewrite header, A/B, xác thực token đơn giản, geo-routing ngay tại POP. Không đặt logic cần DB ở đó.

#### GSLB và anycast
- **GSLB** (global server load balancing) dựa trên DNS: trả IP của region gần/khoẻ, TTL 30–60 s để failover nhanh. Nhược: resolver cache, client "dính" IP cũ.
- **Anycast**: cùng một IP được quảng bá BGP từ nhiều POP, mạng tự đưa gói tới POP gần nhất. Failover gần như tức thì, nhưng TCP dài có thể bị đổi POP khi route đổi, nên hợp với DNS/HTTP ngắn và CDN.

#### Bài học về topology nội bộ (sự cố #10)
FE Next.js render phía server gọi API bằng **hostname public** ([[https://sbom.example.com/api]]). Trong cùng một host Docker, gói đi ra IP public rồi quay lại, hairpin NAT không hỗ trợ → [[ECONNREFUSED]], toàn site 500. Cộng thêm biến môi trường bị **bake vào image** lúc build ([[NEXT_PUBLIC_*]]) nên sửa env runtime không có tác dụng, phải rebuild. Bài học: (1) đường gọi **server-to-server** luôn dùng tên nội bộ (service name của compose, DNS nội bộ) và không đi qua lớp biên; (2) tách rõ biến **public cho trình duyệt** và biến **nội bộ cho SSR**; (3) vẽ sơ đồ "ai gọi ai qua đâu" trước khi deploy, vì cùng một URL đi từ trình duyệt và từ container là hai con đường khác nhau.

### Số liệu cần nhớ
| Mục | Con số |
|---|---|
| Nginx reverse proxy đơn giản | hàng chục nghìn RPS mỗi core |
| TLS handshake | 1.3: 1 RTT; 1.2: 2 RTT; resumption 0–1 RTT |
| Health check | interval 5–30 s, threshold 2–3 lần |
| Connection draining | 30–300 s (ALB mặc định 300 s) |
| CDN hit ratio asset tĩnh | mục tiêu trên 90–95% |
| Purge lan truyền | vài giây đến vài phút |
| DNS TTL cho GSLB | 30–60 s |
| Round trip trong DC / liên lục địa | ~0,5 ms / ~150 ms |

### Sai lầm hay gặp
- Dùng sticky session để giữ state trong RAM của backend: mất máy là mất session, không scale, không drain được.
- Health check nông: [[/]] trả 200 trong khi DB đã chết. Readiness phải kiểm tra dependency quan trọng, nhưng đừng gọi dependency nặng mỗi 5 s.
- Terminate TLS rồi đi plaintext trong mạng không tin cậy mà không biết; hoặc tin [[X-Forwarded-For]] từ mọi nguồn → giả IP qua rate limit.
- Coi purge CDN là bước deploy. Hash trong tên file giải quyết triệt để và miễn phí.
- Cache response theo người dùng ở CDN vì thiếu [[private]] hoặc thiếu [[Vary: Authorization]] → người A thấy dữ liệu người B.
- Nhét logic nghiệp vụ vào gateway (gọi DB, ghép dữ liệu tenant) → gateway thành monolith mới, deploy chậm, lỗi lan toàn hệ.
- Gọi nội bộ qua hostname public hoặc bake env vào image (#10).
- LB một node tự dựng, không có cặp active-passive hay dịch vụ managed: lớp biên trở thành SPOF duy nhất.

### Nói thế nào trong phỏng vấn (EN)
- "I would terminate TLS at the load balancer and keep the backends on a private network, re-encrypting only if the network is not trusted." — Kết thúc TLS ở LB, backend trong mạng riêng.
- "An L7 proxy lets us route by path and tenant header, but an L4 balancer in front handles raw connection volume more cheaply." — L7 route theo path/header, L4 chịu lượng kết nối rẻ hơn.
- "Static assets get content-hashed names with a one-year immutable cache; HTML stays short-lived, so we never depend on purge." — Asset có hash + immutable, HTML TTL ngắn, không phụ thuộc purge.
- "Readiness checks must cover critical dependencies, and connection draining is what makes a deploy invisible to users." — Readiness kiểm tra dependency, draining làm deploy vô hình.
- "Internal service-to-service calls should never go through the public hostname; we had an outage from exactly that." — Gọi nội bộ không qua hostname public, từng gặp sự cố vì vậy.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Vẽ lại sơ đồ biên hiện tại: Nginx Proxy Manager → FE Next.js và apiserver trên cùng EC2 (compose). Đánh dấu từng mũi tên là "từ trình duyệt" hay "từ container". Sự cố #10 xảy ra vì hai loại mũi tên dùng chung một URL.
- Việc cụ thể tuần này: tách [[API_INTERNAL_URL=http://apiserver:5000]] (SSR dùng) và [[NEXT_PUBLIC_API_URL]] (trình duyệt dùng); kiểm tra biến nào bị bake lúc build và ghi vào README deploy. Viết ADR ngắn "Internal vs public hostnames".
- Thêm [[/healthz]] (liveness) và [[/readyz]] (ping Postgres, kiểm tra trạng thái kết nối RabbitMQ, Redis) cho apiserver và worker; cấu hình proxy chỉ route tới instance ready. Đây cũng là nơi lộ ra sự cố #1 (publisher chết) nếu readiness báo trạng thái kết nối broker.
- Watchtower recreate container không có connection draining → mỗi lần redeploy có một cụm request lỗi. Chạy 2 replica apiserver sau proxy + xử lý SIGTERM (đóng listener, chờ in-flight tối đa 30 s) trước khi nghĩ tới blue-green.
- File SBOM upload và file export: cho đi qua **presigned URL** của MinIO/S3 thay vì stream qua apiserver; asset FE tĩnh đặt sau CDN với tên có hash. Đo hit ratio và băng thông apiserver trước/sau.
- Rate limit per-tenant và xác thực JWT hiện nằm trong middleware Go; đó là đúng chỗ khi chỉ có một API. Chỉ cân nhắc API gateway riêng khi mở API public cho khách tích hợp CI/CD.
- Header [[X-Forwarded-For]] chỉ được tin khi request đến từ IP của proxy; kiểm tra middleware lấy IP client đang tin header này vô điều kiện không (ảnh hưởng rate limit per-IP ở bài B9).
- Cache-Control cho API: dashboard metrics có thể [[private, max-age=30]] kèm ETag; mọi endpoint có dữ liệu tenant phải [[private]] hoặc [[no-store]].
`,
  quiz: [
    { t: 'mc', q: 'Yêu cầu: route request có header X-Tenant-Plan=enterprise sang cụm backend riêng. Cần lớp nào?', o: ['L4 load balancer vì chỉ cần nhìn IP đích', 'L7 proxy/gateway vì phải đọc header HTTP', 'DNS GSLB vì quyết định theo tenant xảy ra khi resolve', 'Service mesh vì chỉ sidecar mới đọc được header'], a: 1, why: 'Header HTTP chỉ nhìn thấy ở tầng 7; L4 chỉ thấy IP/port, DNS không biết tenant, sidecar không bắt buộc.' },
    { t: 'mc', q: 'Connection draining (deregistration delay) giải quyết vấn đề gì?', o: ['Giảm số kết nối TCP tới backend khi quá tải', 'Đóng kết nối idle để tiết kiệm file descriptor', 'Cho request đang xử lý hoàn thành trước khi gỡ instance khỏi pool', 'Chuyển session sticky sang backend khác'], a: 2, why: 'Draining ngừng nhận request mới nhưng chờ in-flight xong, nên deploy không gây 502.' },
    { t: 'mc', q: 'Sau khi đặt CDN trước API, người dùng A thỉnh thoảng thấy dữ liệu của người dùng B. Nguyên nhân khả dĩ nhất?', o: ['Response theo người dùng bị cache ở shared cache vì thiếu Cache-Control private hoặc Vary theo Authorization', 'CDN dùng TTL quá ngắn nên revalidate sai', 'ETag trùng nhau giữa hai người dùng', 'Health check của CDN trả về nội dung của request trước'], a: 0, why: 'Cache key mặc định không gồm Authorization; thiếu private/Vary thì shared cache trả cùng một body cho mọi người.' },
    { t: 'mc', q: 'FE render phía server trong container gọi API bằng hostname public của chính host đó và nhận ECONNREFUSED, trong khi trình duyệt gọi bình thường. Cách sửa đúng về mặt kiến trúc?', o: ['Tăng timeout của fetch phía SSR', 'Mở thêm port public cho API', 'Chuyển SSR sang client-side rendering', 'Dùng tên nội bộ (service name/DNS nội bộ) cho gọi server-to-server, tách biến public và nội bộ'], a: 3, why: 'Đây là hairpin NAT; gọi nội bộ không nên đi qua lớp biên và không nên bake URL public vào image.' },
    { t: 'mc', q: 'Chiến lược nào loại bỏ nhu cầu purge CDN khi deploy phiên bản FE mới?', o: ['Đặt s-maxage=0 cho mọi asset', 'Dùng CDN push thay vì pull', 'Tên asset chứa content hash và Cache-Control immutable dài hạn, HTML TTL ngắn', 'Gắn ETag cho mọi asset'], a: 2, why: 'URL mới cho nội dung mới nên không có gì để purge; HTML ngắn hạn trỏ sang asset mới.' },
    { t: 'fill', q: 'Điền: thuật toán chọn ngẫu nhiên 2 backend rồi lấy máy ít kết nối hơn gọi là power of ___ choices.', a: ['two', '2', 'two choices'], why: 'Power of two choices gần tối ưu như least-connections toàn cục nhưng không cần trạng thái toàn cục.' },
    { t: 'fill', q: 'Điền: client gửi header If-None-Match kèm giá trị ___ nhận trước đó để server trả 304 nếu nội dung chưa đổi.', a: ['etag'], why: 'ETag là định danh phiên bản nội dung; khớp thì server trả 304 không body.' },
    { t: 'open', q: 'Design the edge layer for a multi-tenant SaaS API: where do TLS, auth, rate limiting, caching and health checks live, and why?', a: 'TLS kết thúc tại LB/proxy biên để quản lý cert một chỗ; phía sau là mạng riêng. Auth JWT và rate limit per-tenant đặt ở gateway hoặc middleware ngay sau LB, trước khi tốn tài nguyên backend. Asset tĩnh đi qua CDN với tên có hash; API có dữ liệu tenant đánh dấu private, chỉ cache ngắn với ETag. LB dùng readiness check kiểm tra dependency chính và connection draining khi deploy. Gọi nội bộ giữa service dùng DNS nội bộ, không qua hostname public.', keys: ['TLS', 'rate limit', 'readiness', 'cache', 'nội bộ'] }
  ]
},
{ id: 'B2', type: 'block', topic: 'consistency', title: 'Replication: leader-follower, multi-leader, leaderless; sync/async; lag; failover', time: '120 phút',
  goal: 'Chọn được kiểu replication và mức đồng bộ cho một hệ cụ thể, kể tên 3 bất thường do replication lag và cách chặn từng cái, mô tả failover an toàn (fencing) và các tham số Postgres streaming replication hay gây sự cố.',
  md: `
### Vấn đề cần giải
Một node Postgres duy nhất có ba giới hạn cứng: chết là mất dịch vụ (và có thể mất dữ liệu kể từ bản backup gần nhất), đọc chỉ đến ngưỡng IOPS/CPU của một máy, và không sống qua sự cố cả AZ. **Replication** (sao chép cùng dữ liệu sang nhiều node) giải quyết cả ba, nhưng đổi lại ba vấn đề mới: dữ liệu trên replica **trễ** (lag), phải quyết định **ai được ghi** (một leader hay nhiều), và phải **failover** mà không sinh ra hai leader. Mọi câu hỏi về replication trong phỏng vấn đều xoay quanh ba cái giá này.

### Cốt lõi
#### Ba topology
| | Leader-follower (single leader) | Multi-leader | Leaderless (Dynamo-style) |
|---|---|---|---|
| Ghi ở đâu | chỉ leader | mỗi DC/node một leader | bất kỳ replica, client/coordinator gửi tới nhiều node |
| Xung đột ghi | không có | có, phải resolve | có, resolve khi đọc (version vector) |
| Ví dụ | Postgres, MySQL, MongoDB replica set, Kafka partition | CockroachDB geo, Postgres BDR, CouchDB, ứng dụng offline-first | Cassandra, DynamoDB, Riak |
| Mạnh | đơn giản, dễ lý luận | ghi gần người dùng ở nhiều region, chịu mất liên lạc giữa DC | không failover, ghi luôn sẵn sàng |
| Khi KHÔNG dùng | cần ghi ở nhiều region với latency thấp | dữ liệu có ràng buộc duy nhất/invariant (số dư, unique email) | cần transaction hoặc đọc mới nhất tuyệt đối |

#### Replication log: dữ liệu được chở đi dạng gì
- **Statement-based**: gửi câu SQL. Hỏng với [[NOW()]], [[random()]], sequence, trigger có side effect. MySQL cũ dùng; nay gần như bỏ.
- **WAL / physical (byte-level)**: gửi đúng các block thay đổi. Postgres streaming replication là kiểu này. Nhanh, replica là bản sao bit-chính-xác, nhưng **cùng major version**, không chọn bảng, không đổi schema trên replica.
- **Logical / row-based**: gửi "hàng X của bảng Y đổi từ A sang B". Postgres logical replication (publication/subscription), MySQL binlog ROW, Debezium đọc từ đây. Cho phép khác version, replicate một phần bảng, đưa dữ liệu sang hệ khác (Kafka, Elasticsearch).

#### Sync, semi-sync, async
| Mức | Leader trả OK khi | Mất dữ liệu khi leader chết | Chi phí mỗi commit | Nếu replica chậm/chết |
|---|---|---|---|---|
| Async | ghi xong WAL local | có thể mất vài ms đến vài giây dữ liệu | 0 | không ảnh hưởng ghi |
| Semi-sync (ANY 1 of N) | ít nhất 1 replica xác nhận | gần như không | +1 RTT tới replica nhanh nhất | còn replica khác là ghi tiếp |
| Sync toàn bộ | mọi replica xác nhận | không | +1 RTT tới replica chậm nhất | **ghi bị treo** |

Postgres điều khiển qua [[synchronous_standby_names]] và [[synchronous_commit]]: [[off]], [[local]], [[remote_write]] (replica nhận vào OS buffer), [[on]] (replica đã fsync), [[remote_apply]] (replica đã apply, đọc thấy ngay). Có thể đặt **theo transaction**: [[SET LOCAL synchronous_commit = remote_apply]] cho giao dịch cần đọc-ngay-sau-ghi trên replica, còn lại async. Sync qua liên lục địa (+150 ms mỗi commit) hầu như không ai chấp nhận; semi-sync trong cùng region (+1–2 ms) là chuẩn.

#### Replication lag và ba bất thường
- **Read-your-writes** (đọc được điều mình vừa ghi): user lưu policy rồi reload thấy bản cũ vì đọc rơi vào replica. Chặn: (a) đọc dữ liệu "của chính mình" từ leader; (b) sau khi ghi, route đọc về leader trong N giây; (c) client giữ LSN của lần ghi ([[pg_current_wal_lsn()]]), replica chỉ phục vụ khi [[pg_last_wal_replay_lsn() >= LSN]]; (d) [[remote_apply]] cho ghi đó.
- **Monotonic reads** (không đi ngược thời gian): refresh lần 1 thấy comment, lần 2 không thấy vì rơi vào replica chậm hơn. Chặn: ghim một user vào một replica (hash user_id), hoặc truyền LSN tối thiểu.
- **Consistent prefix** (đọc thấy câu trả lời trước câu hỏi): xảy ra khi các partition replicate độc lập. Chặn: dữ liệu liên quan nhân quả cùng partition, hoặc causal consistency (bài B5).
Lag phải được **đo** ([[pg_stat_replication]], [[replay_lag]], CloudWatch AuroraReplicaLag) và có ngưỡng: replica lag quá X giây thì bỏ khỏi pool đọc.

:::diagram
App[apiserver] -> Primary[Postgres primary] : write
Primary -> WAL[WAL sender]
WAL -> R1[Replica 1 cùng AZ] : streaming, sync ANY 1
WAL -> R2[Replica 2 khác AZ] : streaming, async
App -> R2 : read, có lag
DCS[Patroni + etcd] -- Primary : heartbeat, lease
DCS -- R1 : theo dõi LSN
DCS -> VIP[VIP / HAProxy] : trỏ sang leader mới
App -> VIP
:::

#### Failover
- **Phát hiện**: mất heartbeat 10–30 s. Quá ngắn → failover giả do GC pause/mạng chập; quá dài → downtime.
- **Chọn leader mới**: replica có LSN cao nhất (ít mất dữ liệu nhất). Với async, dữ liệu chưa kịp sang replica **mất thật**; nếu leader cũ quay lại, phần ghi dư của nó phải bị discard (hoặc [[pg_rewind]]).
- **Chuyển hướng client**: DNS (chậm vì TTL), VIP, proxy tầng giữa (HAProxy/PgBouncer), hoặc driver biết nhiều host ([[target_session_attrs=read-write]]).
- **Split brain**: leader cũ chỉ bị **mất mạng**, vẫn sống và nhận ghi; client cũ vẫn trỏ vào → hai leader, dữ liệu phân nhánh, hợp nhất tay. Chặn bằng **fencing**: leader phải giữ **lease** trong một kho đồng thuận (etcd/ZooKeeper, Patroni làm vậy) và tự hạ xuống khi lease hết; STONITH (tắt điện node cũ); fencing token ở tầng lưu trữ (bài B6).
- Failover tự động phải trả lời được: mất tối đa bao nhiêu dữ liệu (RPO), bao lâu (RTO), và ai đảm bảo chỉ một leader. Không trả lời được câu ba thì **failover tay** an toàn hơn.

#### Postgres streaming replication: tham số hay gây sự cố
- **Replication slot** giữ WAL cho replica chưa nhận. Replica chết 3 ngày → WAL phình → **đĩa primary đầy** → primary chết theo. Luôn đặt [[max_slot_wal_keep_size]] và cảnh báo slot inactive.
- **hot_standby_feedback = on**: replica báo primary đừng vacuum tuple nó còn cần → hết lỗi "canceling statement due to conflict with recovery", nhưng bloat trên primary khi replica chạy query dài.
- **max_standby_streaming_delay**: replica chờ query bao lâu trước khi huỷ để apply WAL. Replica phục vụ báo cáo dài nên đặt lớn hoặc -1; replica phục vụ đọc realtime nên đặt nhỏ.
- **wal_keep_size**, [[archive_command]]: replica tụt quá xa thì phải rebuild từ base backup ([[pg_basebackup]]), với DB 1 TB là nhiều giờ.

#### Multi-leader: xung đột là bình thường
Hai leader nhận hai bản ghi cho cùng hàng. Lựa chọn: **LWW** (last-writer-wins theo timestamp, âm thầm mất một bản ghi, phụ thuộc đồng hồ), **merge** theo trường/CRDT (bài B5), **ghi lại xung đột** cho người dùng xử lý, hoặc **tránh xung đột**: mỗi bản ghi có home region, chỉ leader đó được ghi. Tránh xung đột là cách rẻ nhất và nên là mặc định.

#### Leaderless và Aurora (giới thiệu)
- Leaderless: ghi tới N replica, chờ W xác nhận; đọc từ R replica, lấy bản mới nhất theo version. W + R > N thì đọc chạm ít nhất một bản mới. Không có failover vì không có leader; chi tiết quorum, sloppy quorum, read repair ở bài B5.
- **Aurora**: tách compute và storage; storage 6 bản trên 3 AZ, ghi cần 4/6, đọc 3/6; chỉ gửi redo log xuống storage nên băng thông replication thấp. Reader instance dùng **chung storage** với writer → lag thường dưới 100 ms, failover sang reader thường dưới 60 s, hay gặp dưới 30 s (AWS Aurora docs). Nhưng reader vẫn có lag (cache page), và chỉ có một writer.

### Số liệu cần nhớ
| Mục | Con số |
|---|---|
| Semi-sync cùng region | +1–2 ms mỗi commit |
| Sync liên lục địa | +100–150 ms mỗi commit, hiếm ai dùng |
| Lag async bình thường | vài ms đến vài trăm ms; vài giây khi tải nặng |
| Phát hiện leader chết | 10–30 s heartbeat timeout |
| Aurora | 6 bản / 3 AZ, ghi 4/6, lag thường dưới 100 ms, failover thường dưới 60 s (hay gặp dưới 30 s) |
| Rebuild replica 1 TB | nhiều giờ |

### Sai lầm hay gặp
- Ghi xong đọc ngay từ replica rồi báo "DB mất dữ liệu". Phải có chính sách route đọc theo loại truy vấn.
- Coi replica là backup: [[DROP TABLE]] replicate trong vài ms. Backup là bản sao **theo thời gian** (PITR), không phải bản sao realtime.
- Bật replication slot rồi quên giám sát → đĩa primary đầy vì một replica đã tắt.
- Bật failover tự động mà không có fencing → split brain còn tệ hơn downtime 5 phút.
- Dùng sync replication toàn bộ "cho chắc" rồi ghi treo khi một replica bảo trì.
- Chọn multi-leader để "ghi ở hai region" mà chưa thiết kế resolve xung đột; LWW âm thầm xoá dữ liệu khách.
- Không đo lag; chỉ phát hiện khi khách báo "số liệu hôm qua".

### Nói thế nào trong phỏng vấn (EN)
- "Reads scale out with replicas, but writes still go through one leader, so replication alone does not solve write scaling." — Replica scale đọc, không scale ghi.
- "I would use semi-synchronous replication within the region: one acknowledged replica gives near-zero data loss without blocking on the slowest node." — Semi-sync trong region: gần như không mất dữ liệu, không treo vì node chậm nhất.
- "After a write, the same user should read from the leader or from a replica that has replayed at least that LSN; otherwise they see stale data." — Đọc sau ghi phải từ leader hoặc replica đã replay tới LSN đó.
- "Automatic failover is only safe with fencing: the old leader must lose its lease before the new one accepts writes." — Failover tự động chỉ an toàn khi có fencing.
- "Replication lag is a metric with an alert threshold, not an assumption." — Lag là metric có ngưỡng cảnh báo, không phải giả định.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Prod chạy Aurora: có writer endpoint và reader endpoint, nhưng hiện mọi truy vấn của apiserver đi vào writer. Phân loại truy vấn: export, Policy Violation Audit, dashboard metrics, danh sách component là **đọc nặng, chịu được lag vài giây** → chuyển sang reader endpoint qua một DB handle thứ hai ([[dbRead]]), giữ writer cho mọi thứ trong luồng upload.
- Luồng upload → parse → lưu component → Lambda enrich đọc lại component: đây là read-your-writes giữa hai process. Lambda phải đọc từ writer, hoặc message gửi Lambda mang theo LSN để đợi replica đuổi kịp. Đừng để Lambda đọc reader endpoint "cho nhẹ writer".
- Canary/pilot chỉ có một container Postgres, không replica, không PITR được kiểm chứng: viết ADR "RPO/RTO cho từng môi trường" và ít nhất bật [[archive_command]] + test restore một lần.
- FDW nối sang DB vulnerability dùng chung: nguồn đích của FDW nên là **replica** của DB vuln, để truy vấn join nặng của tenant không đánh vào primary nơi sync feed OSV/NVD đang ghi. Lưu ý sự cố #5: FDW đóng băng schema, migration trên DB vuln phải kèm bước refresh foreign table.
- Sự cố #4 (statement_timeout 90 s cấp role): tham số cấp role áp cho mọi session của role, kể cả trên reader. Khi tách reader cho báo cáo dài, dùng role riêng với timeout riêng (ví dụ 300 s) thay vì nới chung.
- Đo ngay tuần này: thêm metric [[AuroraReplicaLag]] vào dashboard, cảnh báo trên 5 s; trên Canary chạy [[SELECT * FROM pg_stat_replication]] để xác nhận không có slot mồ côi.
- Multi-leader không cần cho SBOM: mọi tenant ghi vào một region. Ghi điều này vào ADR để không ai đề xuất "active-active hai region" mà chưa có resolve xung đột.
`,
  quiz: [
    { t: 'mc', q: 'Cần replicate chỉ 3 bảng từ Postgres 14 sang Postgres 16 và sang Elasticsearch. Kiểu replication nào phù hợp?', o: ['Streaming replication vì nhanh nhất', 'Logical replication theo row vì khác version và chọn được bảng', 'Statement-based vì dễ đọc log', 'Aurora storage replication vì không cần cấu hình'], a: 1, why: 'Physical/WAL yêu cầu cùng major version và toàn cluster; logical cho phép khác version, chọn bảng và đẩy sang hệ khác.' },
    { t: 'mc', q: 'synchronous_commit = remote_apply trong Postgres nghĩa là gì?', o: ['Leader chờ replica fsync WAL rồi mới trả OK', 'Leader chờ replica nhận WAL vào bộ nhớ OS', 'Leader không chờ replica, chỉ fsync local', 'Leader chờ replica apply xong WAL, nên đọc trên replica thấy ngay dữ liệu vừa commit'], a: 3, why: 'on là replica đã fsync nhưng chưa chắc apply; remote_apply bảo đảm đọc được trên replica, giá là chậm nhất.' },
    { t: 'mc', q: 'Người dùng lưu một policy, trang reload lập tức hiển thị bản cũ, vài giây sau mới đúng. Đây là bất thường gì và sửa thế nào?', o: ['Consistent prefix; sửa bằng cách đặt dữ liệu liên quan vào cùng partition', 'Read-your-writes; sửa bằng cách đọc dữ liệu của chính người dùng từ leader hoặc chờ replica replay tới LSN của lần ghi', 'Monotonic reads; sửa bằng ghim user vào một replica', 'Split brain; sửa bằng fencing'], a: 1, why: 'Đọc không thấy chính lần ghi của mình là read-your-writes; route về leader hoặc theo LSN là cách chặn.' },
    { t: 'mc', q: 'Replica Postgres bị tắt 3 ngày để bảo trì, sau đó primary chết vì đầy đĩa. Nguyên nhân khả dĩ nhất?', o: ['Replication slot giữ WAL cho replica chưa nhận, không có max_slot_wal_keep_size', 'hot_standby_feedback làm primary bloat', 'WAL archive bị lỗi nén', 'Replica gửi ngược dữ liệu về primary'], a: 0, why: 'Slot ngăn Postgres xoá WAL mà replica chưa tiêu thụ; replica chết lâu thì WAL phình đến đầy đĩa.' },
    { t: 'mc', q: 'Điều kiện tối thiểu để failover tự động an toàn trước split brain là gì?', o: ['Heartbeat timeout dưới 5 giây', 'Replica mới có LSN cao nhất', 'Leader cũ bị fencing: mất lease hoặc bị tắt trước khi leader mới nhận ghi', 'Client dùng DNS TTL 30 giây'], a: 2, why: 'Chọn LSN cao nhất giảm mất dữ liệu nhưng không ngăn hai leader; chỉ fencing mới bảo đảm một leader.' },
    { t: 'fill', q: 'Điền: tình huống hai node cùng tin mình là leader và cùng nhận ghi sau sự cố mạng gọi là ___.', a: ['split brain', 'split-brain', 'splitbrain'], why: 'Split brain sinh ra hai nhánh dữ liệu phải hợp nhất tay; fencing là cách chặn.' },
    { t: 'fill', q: 'Điền: Postgres gửi WAL liên tục từ primary sang standby qua cơ chế ___ replication.', a: ['streaming', 'physical', 'streaming replication'], why: 'Streaming (physical) replication gửi WAL byte-level qua walsender/walreceiver, yêu cầu cùng major version.' },
    { t: 'open', q: 'Your dashboard reads are overloading the primary. How would you scale reads with replicas while keeping the application correct?', a: 'Tách DB handle đọc và ghi; dashboard, export, báo cáo đi reader với lag chấp nhận được và hiển thị thời điểm dữ liệu. Truy vấn trong luồng ghi hoặc đọc dữ liệu của chính người dùng ngay sau ghi đi leader, hoặc chờ replica replay tới LSN của lần ghi. Dùng semi-sync trong region để không mất dữ liệu khi failover. Đo replication lag, bỏ replica quá lag khỏi pool, và dùng Patroni hoặc Aurora để failover có fencing.', keys: ['replica', 'read-your-writes', 'lag', 'LSN', 'failover'] }
  ]
},
{ id: 'B3', type: 'block', topic: 'scale', title: 'Partitioning & sharding: key range, hash, consistent hashing, rebalancing, hot spot, secondary index', time: '150 phút',
  goal: 'Chọn và bảo vệ được shard key cho một hệ multi-tenant, vẽ consistent hashing với virtual node, giải thích rebalancing và hot spot, phân biệt secondary index local/global, và áp dụng declarative partitioning của Postgres cho bảng hàng chục triệu dòng.',
  md: `
### Vấn đề cần giải
Replication nhân bản **toàn bộ** dữ liệu lên mỗi node nên không giúp khi một bảng không còn vừa một máy: index không vừa RAM (page cache miss → mỗi lookup thành vài lần đọc đĩa), IOPS ghi chạm trần, VACUUM chạy không kịp, hoặc một tenant lớn làm chậm mọi tenant khác. **Partitioning** (chia một bảng thành nhiều mảnh trong cùng node) và **sharding** (đặt các mảnh trên nhiều node) chia dữ liệu theo một **key** để mỗi truy vấn chỉ chạm một phần. Cái giá: truy vấn không chứa key phải hỏi mọi mảnh, join/transaction xuyên mảnh gần như mất, và chia lại dữ liệu khi thêm node là việc tốn kém nhất.

### Cốt lõi
#### Chọn shard key: bốn tiêu chí
1. **Cardinality cao** và **phân bố đều** theo thời gian: [[tenant_id]] tốt hơn [[country]]; [[created_at]] đều về số lượng nhưng mọi ghi mới dồn vào một mảnh.
2. **Truy vấn chính chứa key**: 80–90% truy vấn phải có [[WHERE tenant_id = ?]], nếu không mọi truy vấn là scatter-gather.
3. **Dữ liệu cần join cùng nhau nằm cùng mảnh** (co-location): project, component, violation của một tenant cùng shard thì join vẫn chạy trong một node.
4. **Ít thay đổi**: đổi shard key của một hàng là xoá chỗ này, chèn chỗ kia.
Multi-tenant SaaS gần như luôn chọn [[tenant_id]]; vấn đề còn lại là tenant quá lớn (xem hot spot).

#### Range vs hash
| | Key range | Hash | Hybrid (hash rồi range) |
|---|---|---|---|
| Cách chia | theo khoảng giá trị key, có sắp xếp | [[hash(key) mod N]] hoặc consistent hashing | hash theo partition key, trong mảnh sắp xếp theo sort key |
| Range scan | tốt (một hoặc vài mảnh liền kề) | mất, phải hỏi mọi mảnh | tốt trong một partition |
| Hot spot | cao với key đơn điệu (timestamp, auto-increment) | thấp | thấp ở tầng partition |
| Ví dụ | HBase, Bigtable, Postgres RANGE | Cassandra Murmur3, Redis Cluster 16384 slot | Cassandra/DynamoDB partition key + clustering/sort key |
| Dùng khi | truy vấn theo khoảng thời gian/khoảng ID | lookup theo key, cần đều | theo tenant rồi theo thời gian |

#### Consistent hashing và virtual node
[[hash(key) mod N]] có một lỗi chết người: thêm 1 node vào 10 node thì khoảng 90% key đổi chỗ (mọi cache miss, mọi dữ liệu di chuyển). **Consistent hashing** đặt cả node và key lên một vòng 0..2^32; key thuộc về node đầu tiên theo chiều kim đồng hồ. Thêm node chỉ lấy đi một phần của **một** node kế cận, trung bình K/N key di chuyển. Vấn đề: ít node thì cung tròn không đều và node mạnh yếu khác nhau. Giải pháp **virtual node**: mỗi node vật lý xuất hiện 100–256 điểm trên vòng (node mạnh gấp đôi thì gấp đôi điểm); tải trải đều, thêm/bớt node lấy một ít từ **mọi** node thay vì từ một node. Cassandra (vnodes), Riak, DynamoDB, Redis Cluster (biến thể slot cố định) đều là họ hàng của ý tưởng này.

#### Rebalancing: ba chiến lược
- **Số partition cố định, nhiều hơn số node** (Elasticsearch shard, Riak, Redis 16384 slot): tạo 1024 partition cho 4 node, thêm node thì di chuyển nguyên partition. Đơn giản, nhưng số partition phải chọn trước và không đổi.
- **Dynamic split** (HBase region, MongoDB chunk, Postgres không có sẵn): partition quá lớn (ví dụ 10 GB) thì tách đôi. Thích ứng với dữ liệu lệch, nhưng lúc mới tạo chỉ có 1 partition (cần pre-split).
- **Theo node với vnodes** (Cassandra): số partition tỉ lệ số node.
Rebalancing **tự động hoàn toàn** nguy hiểm: node chậm vì quá tải → bị coi là chết → rebalancing di chuyển dữ liệu → càng quá tải (cascading). Nên có người bấm nút, hoặc ít nhất giới hạn băng thông di chuyển.

:::diagram
API[apiserver] -> Dir[Directory: tenant_id -> shard] : lookup, cache
API -> Router[Shard router]
Router -> S1[Shard 1: vnode 0-85]
Router -> S2[Shard 2: vnode 86-170]
Router -> S3[Shard 3: vnode 171-255]
Big[Tenant khổng lồ] -> S4[Shard riêng cho tenant lớn]
Router -> S4
API -> GSI[Global secondary index theo purl] : truy vấn không có tenant_id
GSI -> S2 : trỏ tới shard chứa hàng
New[Node mới] -> S1 : nhận 1/N vnode từ mỗi shard
:::

#### Hot spot và "celebrity problem"
Một key nhận tải gấp trăm lần key khác: tenant stress test 200k component, một CVE nổi tiếng được mọi tenant truy vấn, một project được scan mỗi phút. Kỹ thuật:
- **Salting**: ghi vào [[key#0]]..[[key#9]] (hậu tố ngẫu nhiên) → ghi trải 10 partition; đọc phải fan-out 10 lần rồi gộp. Chỉ dùng cho số ít key nóng đã biết.
- **Split** partition nóng (dynamic split) hoặc đưa tenant lớn sang **shard riêng** qua directory (bảng tenant → shard, có cache). Directory là cách duy nhất "đổi chỗ" một tenant mà không re-hash cả hệ.
- **Cache** phía trước cho key đọc nóng; **giới hạn** (quota, rate limit theo tenant) cho key ghi nóng.

#### Secondary index trên dữ liệu đã chia
| | Local (document-partitioned) | Global (term-partitioned) |
|---|---|---|
| Index nằm ở đâu | mỗi shard index dữ liệu của chính nó | index được chia theo **giá trị index**, nằm ở shard khác với dữ liệu |
| Ghi | 1 shard, đồng bộ, rẻ | chạm nhiều shard, thường cập nhật async → index trễ |
| Đọc theo index | **scatter-gather** mọi shard, latency = shard chậm nhất | 1–2 shard, nhanh |
| Ví dụ | Elasticsearch, MongoDB, DynamoDB LSI | DynamoDB GSI (eventually consistent), Cassandra SASI, bảng index tự quản |
| Dùng khi | truy vấn luôn kèm shard key | truy vấn theo thuộc tính không phải shard key, chịu được trễ |

Scatter-gather với 20 shard: nếu mỗi shard có 1% khả năng trả về chậm 1 s thì ~18% truy vấn gặp ít nhất một shard chậm (1 − 0,99^20). Đây là lý do tail latency tệ đi khi tăng số shard.

#### Cross-shard join và transaction
Tránh là chính: **denormalize** (lưu thêm tên project vào bảng violation), **co-locate** theo tenant, **join phía ứng dụng** theo lô (lấy 1000 id rồi một truy vấn [[WHERE id = ANY($1)]], không N+1), **bảng tham chiếu nhỏ nhân bản** lên mọi shard (bảng license SPDX). Transaction xuyên shard cần 2PC hoặc saga (bài B7) — hỏi lại yêu cầu trước khi trả giá đó.

#### Postgres declarative partitioning
~~~sql
CREATE TABLE t_policy_violations (
  tenant_id uuid NOT NULL, policy_id uuid NOT NULL, target_id uuid NOT NULL,
  created_at timestamptz NOT NULL, deleted_at timestamptz,
  PRIMARY KEY (tenant_id, policy_id, target_id)   -- PK phải chứa partition key
) PARTITION BY HASH (tenant_id);
CREATE TABLE t_policy_violations_p0 PARTITION OF t_policy_violations
  FOR VALUES WITH (MODULUS 16, REMAINDER 0);      -- ... p1..p15
CREATE INDEX ON t_policy_violations (policy_id, target_id) WHERE deleted_at IS NULL;
~~~
- [[RANGE]] (theo tháng: xoá dữ liệu cũ bằng [[DETACH PARTITION]] tức thì, không [[DELETE]] hàng triệu dòng), [[LIST]] (theo region/plan), [[HASH]] (theo tenant).
- **Partition pruning** chỉ xảy ra khi [[WHERE]] có partition key với giá trị planner biết; thiếu là quét mọi partition. Index là **per-partition** (local), unique/PK phải chứa partition key.
- Quá nhiều partition (hàng nghìn) làm planning time tăng; vài chục đến vài trăm là vùng an toàn.
- Sự cố #6: bảng violation 9,6 triệu dòng **chỉ có index PK**, vòng đánh giá 238 policy liên tục quét theo [[policy_id]] → DB 4 vCPU ghim 100%, 55% request 500. Bài học theo thứ tự: (1) **index đúng truy vấn** trước (index composite + partial [[WHERE deleted_at IS NULL]] giảm từ phút xuống ms, như sự cố #16); (2) partition theo tenant/time để VACUUM, xoá cũ và pruning rẻ; (3) sharding sang node khác là bước cuối, khi một node thật sự không đủ.

#### Multi-tenant: ba mô hình
| Mô hình | Cách ly | Chi phí | Noisy neighbor | Khi dùng |
|---|---|---|---|---|
| Shared schema + [[tenant_id]] | thấp (dựa vào WHERE, Row-Level Security) | rẻ nhất, migration 1 lần | cao | hàng nghìn tenant nhỏ |
| Schema per tenant | trung bình | migration × N schema | trung bình | vài trăm tenant, yêu cầu cách ly logic |
| DB per tenant | cao | đắt, pool kết nối × N | thấp | khách enterprise, yêu cầu compliance |
Kết hợp phổ biến: shared schema cho đa số, DB/shard riêng cho tenant lớn, directory quyết định.

### Số liệu cần nhớ
| Mục | Con số |
|---|---|
| Thêm 1 node với hash mod N | ~(N−1)/N key đổi chỗ (10→11 node: ~90%) |
| Consistent hashing | ~K/N key đổi chỗ |
| Virtual node mỗi node vật lý | 100–256 |
| Redis Cluster | 16384 hash slot cố định |
| Partition Postgres | vài chục đến vài trăm là an toàn |
| Scatter-gather 20 shard, 1% chậm mỗi shard | ~18% truy vấn gặp shard chậm |

### Sai lầm hay gặp
- Shard theo [[created_at]] hoặc auto-increment: mọi ghi mới dồn vào mảnh cuối, các mảnh cũ nhàn rỗi.
- Shard quá sớm: một Postgres được index đúng và partition hợp lý phục vụ được hàng tỷ dòng. Sharding là bước đắt nhất, làm sau cùng.
- Quên partition key trong PK/unique → Postgres từ chối tạo, hoặc bỏ unique và nhận trùng dữ liệu.
- Truy vấn không có partition key nên pruning không chạy; thấy "đã partition mà vẫn chậm".
- Join xuyên shard bằng vòng lặp N+1 trong code thay vì join theo lô.
- Global secondary index mà không chấp nhận trễ (DynamoDB GSI eventually consistent) → ghi xong đọc không thấy.
- Rebalancing tự động lúc đỉnh tải → cascading failure.

### Nói thế nào trong phỏng vấn (EN)
- "I would shard by tenant_id because nearly every query is scoped to a tenant, which keeps joins local and avoids scatter-gather." — Shard theo tenant_id vì mọi truy vấn đều theo tenant.
- "Consistent hashing with virtual nodes means adding a node moves roughly one over N of the keys instead of nearly all of them." — Consistent hashing + vnode: thêm node chỉ di chuyển ~1/N key.
- "For a few very large tenants I would use a directory so they can be moved to a dedicated shard without rehashing everyone." — Tenant lớn đi shard riêng qua directory.
- "Before sharding across machines, I would partition inside Postgres and fix the indexes; that usually buys years." — Partition và index đúng trước khi shard.
- "A global secondary index makes reads cheap at the cost of asynchronous, eventually consistent writes." — GSI đọc rẻ, ghi async và trễ.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Việc tuần này cho sự cố #6: trên bản sao DB, chạy [[EXPLAIN (ANALYZE, BUFFERS)]] cho 3 truy vấn nóng nhất của vòng eval policy ([[pg_stat_statements]] sắp theo total_time); thêm index composite theo đúng cột lọc + partial [[WHERE deleted_at IS NULL]]; đo lại. Mục tiêu: từ giây xuống ms trước khi bàn partition.
- Partition [[t_policy_violation_scopes]] theo [[HASH (tenant_id)]] 16 phần hoặc [[RANGE (created_at)]] theo tháng nếu có chính sách giữ dữ liệu; chọn RANGE khi muốn xoá cũ bằng DETACH, chọn HASH khi tenant lớn làm VACUUM chậm. Viết ADR nêu lý do và cách migrate online (tạo bảng mới, copy theo lô, swap tên).
- Sự cố #16 (696k pending do 5 file stress test): partial index [[WHERE status = 'pending']] đã giảm từ phút xuống ms; ghi nó vào migration chính thức thay vì chỉ tạo tay trên Canary.
- Hot tenant: tenant stress test với 200k component là noisy neighbor điển hình. Thêm bảng [[t_tenant_placement]] (tenant_id → DB/shard, mặc định shared) ngay cả khi hiện chỉ có một shard: directory có trước thì sau này tách tenant lớn không cần đổi code.
- Kiểm tra mọi truy vấn trên bảng lớn có [[tenant_id]] trong WHERE không (grep repository layer). Truy vấn thiếu tenant_id vừa là lỗ bảo mật vừa là scatter-gather tương lai.
- DB vulnerability dùng chung (OSV/NVD/GHSA) là "shard tham chiếu" được mọi tenant đọc qua FDW: với bảng CVE nên có bản sao đọc hoặc cache theo [[cve_id]] (bài B4), không join FDW trong truy vấn người dùng (sự cố #11).
- Elasticsearch index component: mỗi index là partition theo tenant hay routing theo [[tenant_id]]? Nếu chưa có routing, mọi tìm kiếm là scatter-gather trên mọi shard ES; thêm [[routing=tenant_id]] khi index và search.
`,
  quiz: [
    { t: 'mc', q: 'Cụm cache 10 node dùng hash(key) mod 10. Thêm node thứ 11, tỉ lệ key đổi node xấp xỉ bao nhiêu?', o: ['Khoảng 10%', 'Khoảng 50%', 'Khoảng 90%', 'Không key nào đổi nếu dùng cùng hàm hash'], a: 2, why: 'Với mod N, gần như mọi key đổi vị trí ((N−1)/N); consistent hashing mới giữ ở ~1/N.' },
    { t: 'mc', q: 'Virtual node trong consistent hashing giải quyết vấn đề gì?', o: ['Giảm số lần tính hash mỗi request', 'Trải tải đều hơn và cho phép node mạnh nhận nhiều key hơn, thêm/bớt node lấy dữ liệu từ nhiều node', 'Cho phép range scan trên vòng hash', 'Thay thế nhu cầu directory cho tenant lớn'], a: 1, why: 'Ít node vật lý thì cung tròn lệch; vnode làm mỗi node có nhiều điểm trên vòng nên đều hơn và rebalancing mịn hơn.' },
    { t: 'mc', q: 'Bảng event được shard theo created_at (range). Triệu chứng nào sẽ xuất hiện?', o: ['Truy vấn theo khoảng thời gian phải hỏi mọi shard', 'Mọi ghi mới dồn vào shard chứa khoảng thời gian hiện tại, các shard cũ nhàn rỗi', 'Không thể tạo secondary index', 'Không thể xoá dữ liệu cũ'], a: 1, why: 'Key đơn điệu theo thời gian tạo hot spot ghi ở mảnh cuối; range scan lại rất tốt và xoá cũ rất dễ.' },
    { t: 'mc', q: 'DynamoDB GSI (global secondary index) đánh đổi gì so với truy vấn theo partition key?', o: ['Đọc qua GSI tốn gấp đôi vì phải scatter-gather', 'Ghi đồng bộ vào mọi partition nên ghi chậm nhưng đọc mạnh nhất quán', 'Đọc chỉ chạm ít partition nhưng index cập nhật async nên eventually consistent', 'GSI chỉ hỗ trợ truy vấn bằng nhau, không hỗ trợ sort key'], a: 2, why: 'Global index chia theo giá trị index nên đọc rẻ; ghi lan sang partition khác và được cập nhật bất đồng bộ.' },
    { t: 'mc', q: 'Bảng Postgres đã partition theo tenant_id nhưng truy vấn vẫn quét toàn bộ partition. Nguyên nhân khả dĩ nhất?', o: ['Postgres không hỗ trợ pruning với HASH partition', 'WHERE không chứa tenant_id hoặc giá trị không xác định được lúc plan/execute', 'Index trên partition cha chưa được tạo', 'Số partition ít hơn số CPU'], a: 1, why: 'Partition pruning cần điều kiện trên partition key; thiếu thì planner phải quét mọi partition.' },
    { t: 'fill', q: 'Điền: thêm hậu tố ngẫu nhiên vào một key quá nóng để trải ghi lên nhiều partition gọi là ___.', a: ['salting', 'key salting', 'salt'], why: 'Salting trải ghi nhưng đọc phải fan-out và gộp; chỉ dùng cho số ít key nóng đã biết.' },
    { t: 'fill', q: 'Điền: truy vấn theo secondary index local phải gửi tới mọi shard rồi gộp kết quả, kiểu truy vấn này gọi là ___.', a: ['scatter-gather', 'scatter gather', 'scatter/gather'], why: 'Scatter-gather có latency bằng shard chậm nhất, tệ dần khi số shard tăng.' },
    { t: 'open', q: 'How would you shard a multi-tenant SBOM database, and how do you handle one tenant that is 100 times larger than the others and cross-tenant reports?', a: 'Shard theo tenant_id vì mọi truy vấn đều theo tenant và join giữ cục bộ; dùng consistent hashing hoặc số partition cố định để rebalancing rẻ. Có bảng directory tenant → shard để tenant khổng lồ được chuyển sang shard riêng mà không rehash. Báo cáo cross-tenant chạy scatter-gather bất đồng bộ hoặc đổ sang kho phân tích riêng, không chạy trên luồng người dùng. Trước khi shard, partition trong Postgres và sửa index để kéo dài tuổi thọ một node.', keys: ['tenant_id', 'directory', 'hot spot', 'scatter-gather', 'rebalancing'] }
  ]
},
{ id: 'B4', type: 'block', topic: 'storage', title: 'NoSQL và storage engine: B-tree vs LSM-tree, key-value, wide-column, document, graph', time: '120 phút',
  goal: 'Giải thích được vì sao LSM ghi nhanh đọc chậm hơn B-tree (với số write/read amplification), thiết kế một bảng DynamoDB/Cassandra từ access pattern, và chọn đúng loại store cho từng loại dữ liệu trong một hệ thật kèm cái giá của polyglot persistence.',
  md: `
### Vấn đề cần giải
B-tree (Postgres, MySQL InnoDB) cập nhật **tại chỗ** từng page 8–16 KB: mỗi ghi nhỏ là một lần đọc page, sửa, ghi lại page, cộng WAL. Với workload ghi hàng trăm nghìn dòng/giây (log, metric, event, kết quả scan), random write trên B-tree chạm trần IOPS trước khi chạm trần CPU. NoSQL ra đời không phải vì "schema linh hoạt" mà vì ba áp lực: **ghi nhiều hơn đọc**, **dữ liệu không vừa một máy** (sharding tích hợp sẵn, bài B3), và **access pattern** không hợp mô hình quan hệ (graph, tài liệu lồng nhau). Cái giá là mất join, mất transaction đa dòng (phần lớn), và một engine nữa phải vận hành.

### Cốt lõi
#### LSM-tree: ghi tuần tự, đọc nhiều tầng
1. Ghi vào **WAL** (append) và **memtable** (cấu trúc sắp xếp trong RAM, thường skip list). Trả OK ngay → ghi là tuần tự, cực nhanh.
2. Memtable đầy (vài chục MB) → **flush** thành **SSTable** (Sorted String Table, file bất biến, sắp xếp theo key) ở level 0.
3. **Compaction** chạy nền: gộp SSTable, bỏ bản cũ và tombstone (dấu xoá). **Size-tiered** (gộp file cùng cỡ, ít write amp, nhiều space amp) vs **leveled** (mỗi level gấp 10 lần level trước, ít space amp, nhiều write amp).
4. Đọc: memtable → SSTable mới nhất → cũ hơn. **Bloom filter** mỗi SSTable trả lời "chắc chắn không có" để bỏ qua file (10 bit/key ≈ 1% false positive, không bao giờ false negative).

:::diagram
W[Write] -> WAL[WAL append tuần tự]
W -> Mem[Memtable sắp xếp trong RAM]
Mem -> L0[SSTable level 0] : flush khi đầy
L0 -> L1[SSTable level 1] : compaction
L1 -> L2[SSTable level 2 x10] : compaction
R[Read key] -> Mem
R -> Bloom[Bloom filter mỗi SSTable] : có thể có?
Bloom -> L0
Bloom -> L1
Bloom -> L2
:::

| Tiêu chí | B-tree | LSM-tree |
|---|---|---|
| Ghi | random I/O, in-place, page split | tuần tự, append; throughput ghi cao hơn nhiều lần |
| Đọc điểm | 1 đường đi O(log N), dự đoán được | nhiều SSTable, nhờ bloom filter; p99 kém hơn |
| Write amplification | 2–3× (page + WAL) | 10–30× (leveled) do compaction ghi lại dữ liệu |
| Read amplification | thấp | cao hơn, giảm bằng bloom filter và cache |
| Space amplification | fragmentation, bloat (Postgres cần VACUUM) | size-tiered có thể gấp 2×; leveled ~1,1× |
| Độ ổn định latency | tốt | compaction có thể gây stall nếu ghi vượt tốc độ compaction |
| Range scan | tốt | tốt trong một SSTable, phải merge nhiều file |
| Transaction, khoá | chín muồi | hạn chế |
| Ví dụ | Postgres, InnoDB, SQLite, etcd (bbolt) | RocksDB, LevelDB, Cassandra, ScyllaDB, HBase, MyRocks, TiKV |
| Khi KHÔNG dùng | ingest hàng trăm nghìn dòng/giây liên tục trên đĩa thường | đọc điểm p99 cực chặt với dữ liệu nóng, cần transaction phức tạp |

Ghi nhớ: write amplification là lý do SSD của cụm Cassandra mòn nhanh; read amplification là lý do Cassandra cần nhiều RAM cho bloom filter và key cache.

#### Bốn mô hình dữ liệu NoSQL
| Mô hình | Dữ liệu là gì | Truy vấn | Ví dụ | Hợp | Không hợp |
|---|---|---|---|---|---|
| Key-value | key → blob/opaque | get/put/delete theo key | Redis, DynamoDB (đơn giản), RocksDB | session, cache, counter, feature flag | truy vấn theo giá trị |
| Wide-column | partition key → nhiều hàng sắp theo sort key | theo partition, range trên sort key | Cassandra, DynamoDB, Bigtable, HBase | time series, event theo thực thể, ghi nặng | join, truy vấn ad-hoc |
| Document | JSON lồng nhau, schema lỏng | theo id, theo trường có index, aggregation | MongoDB, Couchbase, Postgres jsonb | aggregate đọc nguyên khối, schema thay đổi | many-to-many, báo cáo chéo |
| Graph | node, edge, thuộc tính | traversal độ sâu biến đổi | Neo4j, Neptune, JanusGraph | mạng phụ thuộc, quan hệ xã hội, fraud | aggregate, báo cáo theo bảng |

#### DynamoDB / Cassandra: thiết kế từ truy vấn
Quy trình ngược với relational: **liệt kê access pattern trước**, mỗi pattern là một partition key + sort key (hoặc một GSI), **denormalize** để một truy vấn trả đủ dữ liệu. Ví dụ component của một project:
~~~text
PK = PROJECT#{project_id}          SK = COMP#{purl}          -> component của project, sắp theo purl
PK = PROJECT#{project_id}          SK = VULN#{severity}#{cve} -> vuln của project, lọc theo severity bằng begins_with
GSI1 PK = CVE#{cve_id}             SK = PROJECT#{project_id} -> project nào bị CVE này (truy vấn ngược)
~~~
Giới hạn phải nhớ: DynamoDB item tối đa 400 KB, một partition tối đa 10 GB và 3000 RCU / 1000 WCU; Cassandra khuyến nghị partition dưới ~100 MB và vài trăm nghìn cell. Partition key chỉ là [[tenant_id]] sẽ nổ ở tenant lớn → ghép thêm ([[tenant_id#project_id]]) hoặc thêm bucket theo thời gian. Không có join, không có truy vấn ad-hoc: thêm pattern mới = thêm GSI hoặc ghi thêm bản sao, và GSI là eventually consistent.

#### Document khi nào hợp
MongoDB/jsonb hợp khi một **aggregate** (file SBOM thô với metadata lồng nhau, cấu hình policy dạng cây, kết quả scan một lần) được đọc và ghi **nguyên khối**, và quan hệ là one-to-few nhúng được. Không hợp khi cùng một thực thể xuất hiện trong nhiều tài liệu (component xuất hiện ở hàng nghìn project) vì cập nhật phải lan ra mọi bản sao. Document 16 MB (MongoDB) là trần; [[$lookup]] là join yếu. Postgres [[jsonb]] với GIN index là lựa chọn "document đủ dùng" khi đã có Postgres.

#### Graph khi nào hợp
Khi câu hỏi là **traversal độ sâu biến đổi**: "component X kéo theo những gì ở độ sâu bất kỳ", "những project nào phụ thuộc gián tiếp vào log4j". Trong Postgres, [[WITH RECURSIVE]] trên bảng edge chạy tốt tới vài trăm nghìn edge và độ sâu vài chục; vượt ngưỡng đó, hoặc cần thuật toán đồ thị (shortest path, centrality), mới đáng mang Neo4j/Neptune. Không dùng graph DB cho báo cáo tổng hợp theo bảng.

#### Elasticsearch không phải primary store
Inverted index tuyệt vời cho full-text, filter nhiều chiều, aggregation; nhưng **near-real-time** (refresh mặc định 1 s), không transaction, đổi mapping là reindex toàn bộ, resilience ghi trong lịch sử từng có vấn đề khi split-brain. Dùng ES như **derived store**: nguồn sự thật ở Postgres, đẩy sang ES qua outbox/CDC (bài B7), có job reindex đầy đủ để sửa lệch. Mất ES = mất tìm kiếm, không mất dữ liệu.

#### Chọn store theo access pattern
| Dữ liệu / truy vấn | Store | Lý do |
|---|---|---|
| Quan hệ nhiều chiều, cần transaction, báo cáo ad-hoc | Postgres | join, ACID, index đa dạng |
| Lookup theo key, TTL, counter, lock | Redis | in-memory, cấu trúc dữ liệu, ~0,2 ms |
| Ghi rất nhiều theo thực thể, đọc theo thực thể + khoảng thời gian | Cassandra / DynamoDB | LSM, partition + sort key, scale ngang sẵn |
| Tài liệu lồng nhau đọc nguyên khối | MongoDB hoặc Postgres jsonb | aggregate, schema lỏng |
| Full-text, facet | Elasticsearch (derived) | inverted index |
| Traversal độ sâu biến đổi, thuật toán đồ thị | Graph DB | pointer chasing |
| File lớn (SBOM gốc, export) | S3/MinIO | rẻ, bền, presigned URL |

#### Polyglot persistence và cái giá
Mỗi store thêm vào là: một đường **đồng bộ dữ liệu** (dual write là bug chờ nổ; cần outbox/CDC), một cửa sổ **không nhất quán** phải giải thích cho người dùng, một bộ **backup/restore/upgrade/monitoring** riêng, một tập kỹ năng vận hành. Sự cố #13: Watchtower kéo [[mongo:latest]], image mới cần kernel mới hơn host → crash. Mỗi engine thêm vào là thêm một chỗ phải **pin version** và đọc release note. Quy tắc: thêm store khi có access pattern mà store hiện có không phục vụ nổi **sau khi đã index/partition đúng**, không thêm vì "stack hiện đại".

### Số liệu cần nhớ
| Mục | Con số |
|---|---|
| Page B-tree | Postgres 8 KB, InnoDB 16 KB |
| Bloom filter | 10 bit/key ≈ 1% false positive |
| Write amplification LSM leveled | 10–30× |
| Memtable flush | vài chục MB (RocksDB mặc định 64 MB) |
| DynamoDB | item 400 KB; partition 10 GB, 3000 RCU / 1000 WCU |
| MongoDB document | tối đa 16 MB |
| Elasticsearch refresh | mặc định 1 s (near-real-time) |
| SSD random read / Redis op | ~100 µs / ~0,2 ms qua mạng |

### Sai lầm hay gặp
- Chọn NoSQL "để scale" khi dữ liệu 50 GB và vấn đề thật là thiếu index. Postgres phục vụ hàng tỷ dòng khi index và partition đúng.
- Mô hình hoá Cassandra/DynamoDB như bảng quan hệ (normalize rồi join trong code) → N+1 request, hot partition.
- Partition key cardinality thấp hoặc lệch ([[tenant_id]] đơn thuần) → một partition nổ 10 GB, throttle.
- Dùng Elasticsearch làm nguồn sự thật; đổi mapping xong mất đường quay lại.
- Dual write Postgres + ES trong code: một bên fail là lệch vĩnh viễn, không ai biết.
- Bỏ qua compaction: ghi vượt tốc độ compaction → stall, đĩa đầy vì SSTable chưa gộp.
- Kéo image [[latest]] cho DB (sự cố #13): version DB là quyết định có chủ đích, không phải mặc định.

### Nói thế nào trong phỏng vấn (EN)
- "An LSM tree turns random writes into sequential appends, trading higher write amplification from compaction and slightly slower point reads." — LSM đổi random write thành append, trả giá bằng compaction và đọc chậm hơn chút.
- "With DynamoDB I start from the access patterns and design the partition and sort keys so each pattern is a single query." — Với DynamoDB, bắt đầu từ access pattern, mỗi pattern là một truy vấn.
- "Elasticsearch is a derived index fed from the system of record, never the source of truth." — ES là index dẫn xuất, không phải nguồn sự thật.
- "I would only add a second datastore when the current one cannot serve an access pattern after proper indexing, because every store adds a synchronization problem." — Chỉ thêm store khi store hiện tại không phục vụ nổi, vì mỗi store thêm một vấn đề đồng bộ.
- "A bloom filter lets reads skip SSTables that definitely do not contain the key, at about one percent false positives." — Bloom filter cho đọc bỏ qua SSTable chắc chắn không chứa key.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Liệt kê 10 access pattern nóng nhất (component của project, vuln của project theo severity, project bị CVE X, license của component theo tenant, pending enrichment, audit theo khoảng thời gian...) và ghi cạnh mỗi pattern store đang phục vụ + thời gian p95. Đây là bảng quyết định thật, làm trong một buổi.
- Postgres là nguồn sự thật, giữ nguyên. Sự cố #3 (Preload 490k vulnerabilities × 10 goroutine → OOM 5 GiB) không phải lỗi chọn DB mà là lỗi **access pattern**: tải cả aggregate khi chỉ cần đếm/duyệt theo lô. Sửa bằng truy vấn theo lô và cursor trước khi nghĩ tới store khác.
- MongoDB hiện giữ gì? Nếu chỉ là SBOM thô/kết quả scan đọc nguyên khối, cân nhắc chuyển sang S3/MinIO (file) + Postgres jsonb (metadata) để bớt một engine phải vận hành — sự cố #13 là chi phí thật của engine đó. Viết ADR "giữ hay bỏ MongoDB" với số liệu dung lượng và truy vấn.
- Elasticsearch cho tìm kiếm component: xác nhận đường đồng bộ hiện tại (ghi trực tiếp từ code hay qua queue). Nếu là dual write, thêm outbox (bài B7) và job reindex theo tenant để sửa lệch; đo lệch bằng đếm Postgres vs ES mỗi đêm.
- Dữ liệu vulnerability dùng chung (OSV/NVD/GHSA/EUVD/JVNDB) là **ghi nhiều theo feed, đọc theo key** ([[cve_id]], [[purl]]): ứng viên tốt cho cache Redis theo key hoặc wide-column nếu một ngày tách khỏi Postgres; hiện tại partial index + FDW tới replica là đủ.
- Pin version mọi image DB trong compose ([[postgres:16.4]], [[mongo:8.2.12]], [[redis:7.2]]) và tắt Watchtower cho các container dữ liệu; nâng cấp là PR có review.
- Dependency graph của SBOM (component phụ thuộc component): hiện là bảng edge trong Postgres; đo [[WITH RECURSIVE]] trên project 90k component. Dưới 1 s thì không cần graph DB; ghi ngưỡng này vào ADR.
`,
  quiz: [
    { t: 'mc', q: 'Vì sao LSM-tree đạt throughput ghi cao hơn B-tree trên cùng phần cứng?', o: ['Vì LSM không cần WAL', 'Vì ghi vào memtable và flush/compaction là I/O tuần tự thay vì random write tại chỗ vào page', 'Vì LSM nén dữ liệu tốt hơn', 'Vì LSM không có index'], a: 1, why: 'Append tuần tự tận dụng băng thông đĩa; B-tree phải đọc-sửa-ghi từng page ngẫu nhiên.' },
    { t: 'mc', q: 'Bloom filter trong LSM-tree bảo đảm điều gì?', o: ['Nếu trả lời có thì key chắc chắn tồn tại', 'Không bao giờ sai', 'Nếu trả lời không thì key chắc chắn không có trong SSTable đó; trả lời có thì có thể sai với xác suất nhỏ', 'Thay thế hoàn toàn việc đọc SSTable'], a: 2, why: 'Bloom filter không có false negative nhưng có false positive (~1% với 10 bit/key), nên dùng để bỏ qua file chắc chắn không chứa key.' },
    { t: 'mc', q: 'Bước đầu tiên khi thiết kế bảng DynamoDB/Cassandra là gì?', o: ['Vẽ ERD chuẩn hoá 3NF rồi map sang bảng', 'Liệt kê access pattern và thiết kế partition key + sort key để mỗi pattern là một truy vấn', 'Chọn số partition cố định', 'Tạo GSI cho mọi cột'], a: 1, why: 'Không có join và truy vấn ad-hoc nên schema phải sinh ra từ truy vấn, denormalize có chủ đích.' },
    { t: 'mc', q: 'Đội đề xuất dùng Elasticsearch làm nơi lưu duy nhất cho component. Rủi ro lớn nhất?', o: ['ES không hỗ trợ aggregation', 'ES chậm hơn Postgres khi full-text', 'Đổi mapping cần reindex toàn bộ và không có transaction; mất ES là mất dữ liệu gốc', 'ES không chạy được trên Docker'], a: 2, why: 'ES là derived store near-real-time, không transaction; nguồn sự thật phải ở nơi có thể reindex từ đó.' },
    { t: 'mc', q: 'Truy vấn nào là lý do chính đáng để cân nhắc graph DB thay vì Postgres?', o: ['Đếm số component theo license cho mỗi tenant', 'Tìm mọi project phụ thuộc gián tiếp vào một component ở độ sâu bất kỳ, trên đồ thị hàng chục triệu edge', 'Lưu file SBOM thô dạng JSON', 'Tìm kiếm full-text tên component'], a: 1, why: 'Traversal độ sâu biến đổi trên đồ thị lớn là điểm mạnh của graph DB; aggregate và full-text thì không.' },
    { t: 'fill', q: 'Điền: quá trình gộp các SSTable, loại bản cũ và tombstone trong LSM-tree gọi là ___.', a: ['compaction'], why: 'Compaction là nguồn write amplification và cũng là thứ giữ read amplification trong tầm kiểm soát.' },
    { t: 'fill', q: 'Điền: cấu trúc trong RAM đã sắp xếp nhận write trước khi flush thành SSTable gọi là ___.', a: ['memtable'], why: 'Memtable cùng WAL làm ghi trở thành tuần tự; đầy thì flush thành SSTable bất biến.' },
    { t: 'open', q: 'You need to store vulnerability matches for 100k components with about 10 matches each, queried by project and by CVE. Which store and data model would you choose, and why?', a: 'Khoảng 1 triệu dòng là nhỏ, Postgres đủ: bảng match có index (project_id, severity) và index (cve_id) phục vụ cả hai pattern, partition theo tenant khi lớn. Nếu đã ở quy mô hàng trăm triệu match và ghi theo feed liên tục thì wide-column với PK project_id và SK severity#cve, cộng GSI theo cve_id chấp nhận eventually consistent. Mọi store dẫn xuất (ES, cache) được nuôi bằng outbox/CDC, không dual write. Quyết định dựa trên access pattern và số liệu đo, không dựa trên xu hướng.', keys: ['access pattern', 'index', 'partition key', 'denormalize', 'outbox'] }
  ]
},
{ id: 'B5', type: 'block', topic: 'consistency', title: 'Mô hình nhất quán: linearizability, causal, eventual; CAP/PACELC; quorum N/W/R; version vector; CRDT', time: '150 phút',
  goal: 'Định nghĩa đúng từng mức nhất quán bằng ví dụ hai client, phát biểu CAP và PACELC không sai, tính được quorum N/W/R và chỉ ra khi nào W+R>N vẫn trả dữ liệu cũ, đọc được version vector, chọn CRDT phù hợp, và đặt quy tắc hợp nhất rõ ràng cho dữ liệu dùng chung.',
  md: `
### Vấn đề cần giải
Khi dữ liệu có nhiều bản sao (replica, cache, Lambda ghi lại, hai tenant cùng chạm một hàng), câu "đọc trả về giá trị mới nhất" không còn nghĩa hiển nhiên: mới nhất theo đồng hồ nào, theo thứ tự ai thấy? **Mô hình nhất quán** là hợp đồng giữa hệ lưu trữ và ứng dụng về **thứ tự và thời điểm** các bản sao thống nhất. Chọn mức quá mạnh thì trả giá bằng latency (chờ đồng thuận mỗi lần ghi) và sẵn sàng (từ chối phục vụ khi mất liên lạc); chọn quá yếu thì ứng dụng phải tự xử lý xung đột, và nếu không ai viết quy tắc đó, hệ sẽ tự chọn một quy tắc ngẫu nhiên — thường là "ai ghi trước thắng" hoặc "ai ghi sau thắng" — rồi mất dữ liệu trong im lặng.

### Cốt lõi
#### Các mức nhất quán, từ mạnh đến yếu
| Mức | Hợp đồng | Ví dụ hai client | Hệ thống | Giá |
|---|---|---|---|---|
| Linearizability (strong) | mọi thao tác như xảy ra tức thời tại một điểm, theo thứ tự thời gian thực; đọc sau khi ghi hoàn tất luôn thấy ghi đó | A ghi x=1 và nhận OK lúc 10:00:00; B đọc lúc 10:00:01 **phải** thấy 1 | etcd, ZooKeeper (ghi), Spanner, Postgres một node | mỗi thao tác chờ đồng thuận hoặc leader; không sẵn sàng khi partition |
| Sequential | mọi client thấy cùng một thứ tự, nhưng không ràng buộc với thời gian thực | B có thể thấy x=1 trễ, nhưng mọi người thấy cùng thứ tự ghi | ít dùng trực tiếp | gần như linearizability |
| Causal | nếu ghi 2 phụ thuộc ghi 1 (happens-before) thì ai thấy 2 cũng thấy 1; ghi đồng thời có thể hiện khác thứ tự | câu trả lời không bao giờ hiện trước câu hỏi | MongoDB causal session, COPS, Cosmos DB session | metadata (vector clock), theo dõi phụ thuộc |
| Session guarantees | read-your-writes, monotonic reads, monotonic writes, writes-follow-reads trong một phiên | A luôn thấy chính ghi của A | Postgres qua LSN routing (bài B2), DynamoDB consistent read | routing, ghim phiên |
| Eventual | nếu ngừng ghi, mọi bản sao **rồi sẽ** bằng nhau; không hứa bao lâu, không hứa thứ tự | B có thể thấy 1 rồi 0 rồi 1 | DNS, Cassandra ONE, S3 (trước 2020), cache | ứng dụng tự xử lý xung đột và cửa sổ cũ |

"Eventual" không phải mức, nó là **thiếu mức**: luôn hỏi "eventual trong bao lâu, và ai hợp nhất khi xung đột".

#### CAP đúng nghĩa và PACELC
CAP: khi (và chỉ khi) có **network partition**, hệ phải chọn **C** (từ chối hoặc chờ, giữ linearizability) hoặc **A** (trả lời bằng dữ liệu có thể cũ). Không phải "chọn 2 trong 3": P không phải lựa chọn mà là thực tế; và lúc không partition CAP không nói gì. **PACELC** bổ sung: nếu Partition thì A hay C, **Else** (bình thường) thì **Latency** hay **Consistency**.
| Hệ | P: A hay C | E: L hay C | Ghi chú |
|---|---|---|---|
| Cassandra, DynamoDB, Riak | A | L | quorum chỉnh được, mặc định nghiêng latency |
| MongoDB | A (ghi về primary mới) | C (đọc primary) | theo phân loại Abadi |
| etcd, ZooKeeper, Spanner, CockroachDB | C | C | ghi chờ majority |
| Postgres + Patroni | C (fencing) | C | một leader |
Trong phỏng vấn, nói "CP/AP" theo **từng thao tác**: hệ thanh toán CP cho ghi số dư, AP cho hiển thị lịch sử.

#### Quorum N/W/R
Dữ liệu có **N** bản sao; ghi thành công khi **W** bản xác nhận; đọc hỏi **R** bản và lấy bản mới nhất theo version. **W + R > N** → tập đọc và tập ghi giao nhau ít nhất một node, nên đọc thấy ít nhất một bản mới. Thường N=3, W=2, R=2. W=1 ghi nhanh nhưng mất dữ liệu nếu node đó chết trước khi lan; R=1 đọc nhanh, có thể cũ; W=N, R=1 cho hệ đọc nhiều.
Vì sao W+R>N vẫn **không** là linearizability:
- **Sloppy quorum + hinted handoff**: node "nhà" chết, ghi tạm sang node khác (giữ hint, trả lại sau). Ghi vẫn đủ W nhưng nằm ngoài tập N chính thức → đọc R node chính thức không thấy. Được sẵn sàng, mất bảo đảm giao nhau.
- Hai ghi **đồng thời** cùng key → cần quy tắc hợp nhất (LWW hay version vector), quorum không giải quyết.
- Ghi **thất bại một phần** (đạt 1 trong W=2) không rollback → một số node có giá trị mới.
- Đọc và ghi **xen kẽ về thời gian** vẫn tạo ra kết quả không linearizable (Kleppmann, chương 5).
Sửa lệch nền: **read repair** (đọc R bản, thấy bản cũ thì ghi đè lại ngay) và **anti-entropy** (tiến trình nền so sánh **Merkle tree** — cây hash theo khoảng key — chỉ truyền nhánh khác nhau; Cassandra [[nodetool repair]], DynamoDB nội bộ).

:::diagram
C[Client ghi W=2] -> Coord[Coordinator]
Coord -> N1[Replica 1] : ack
Coord -> N2[Replica 2] : ack
Coord -> N3[Replica 3] : timeout
Coord -> H[Node tạm giữ hint] : sloppy quorum
H -> N3 : hinted handoff khi N3 sống lại
Rd[Client đọc R=2] -> N2 : version 7
Rd -> N3 : version 6 cũ
Rd -> N3 : read repair ghi version 7
N1 -- N2 : anti-entropy Merkle tree
:::

#### LWW: tiện và nguy hiểm
Last-writer-wins chọn bản có timestamp lớn nhất và **bỏ** bản kia. Ba vấn đề: đồng hồ hai node lệch vài chục ms là "mới hơn" sai; hai ghi đồng thời thì một ghi đã **trả OK** cho client nhưng biến mất; không hợp cho dữ liệu kiểu "thêm vào tập hợp". Cassandra mặc định LWW ở mức cell; Riak cho chọn. LWW chấp nhận được khi mỗi key chỉ có một người ghi hợp lệ (hồ sơ do chính user sửa) hoặc dữ liệu là bất biến có version.

#### Version vector: phát hiện xung đột thay vì đoán
Mỗi replica giữ bộ đếm riêng: giá trị kèm vector [[{A:2, B:1}]]. So sánh hai vector: nếu mọi thành phần của v1 ≤ v2 thì v1 **cũ hơn** (v2 thay thế được); nếu mỗi bên có một thành phần lớn hơn ([[{A:2,B:1}]] vs [[{A:1,B:2}]]) thì **đồng thời** → giữ cả hai (siblings), client đọc phải hợp nhất rồi ghi lại với vector gộp. Vector clock (bộ đếm theo client) vs version vector (theo replica) khác nhau ở ai tăng bộ đếm; dotted version vector sửa trường hợp nhiều client ghi qua một replica. Giá: metadata lớn dần theo số replica, siblings tích luỹ nếu client không hợp nhất.

#### CRDT: cấu trúc dữ liệu tự hợp nhất
Conflict-free Replicated Data Type: hai bản sao hợp nhất bằng một phép **giao hoán, kết hợp, luỹ đẳng** nên mọi bản sao hội tụ không cần điều phối.
| CRDT | Cách merge | Dùng cho | Hạn chế |
|---|---|---|---|
| G-counter | mỗi node một bộ đếm chỉ tăng; merge = max từng thành phần; giá trị = tổng | đếm like, đếm request | không giảm được |
| PN-counter | hai G-counter (cộng, trừ) | tồn kho xấp xỉ, số lượt | không bảo đảm không âm |
| LWW-register | giá trị + timestamp, lấy lớn nhất | cấu hình một người sửa | chính là LWW với mọi rủi ro |
| OR-set (observed-remove) | mỗi lần add gắn tag duy nhất; remove chỉ xoá tag đã thấy → add thắng remove đồng thời | giỏ hàng, tập tag, thành viên | tombstone/tag tích luỹ, cần dọn |
| Sequence CRDT (RGA, Yjs, Automerge) | vị trí có id duy nhất | soạn thảo cộng tác | metadata lớn |
CRDT giải quyết **hội tụ**, không giải quyết **invariant**: số dư không âm, unique username, "chỉ một người được đặt phòng" vẫn cần đồng thuận (bài B6). Dùng CRDT khi hoạt động offline hoặc multi-leader là yêu cầu thật, không phải vì nó hay.

#### Dữ liệu dùng chung cần quy tắc hợp nhất được viết ra (sự cố #15)
Bảng component dùng chung giữa mọi tenant: tenant nào import component trước thì giá trị license declared của tenant đó được ghi; tenant sau import cùng component với license khác bị bỏ qua ([[INSERT ... ON CONFLICT DO NOTHING]]). Kết quả: tenant B nhìn thấy license mà **file của tenant A** khai báo — leak dữ liệu cross-tenant và sai nghiệp vụ. Không ai "chọn" first-writer-wins; nó là hệ quả của một câu lệnh tiện tay. Fix đúng là tách **fact dùng chung bất biến** (định danh purl, dữ liệu từ nguồn công khai như ClearlyDefined) khỏi **quan sát theo tenant** (license file của tenant khai báo) và lưu overlay per-tenant, view của tenant = overlay ghi đè lên shared. Bài học tổng quát: với mọi bảng có nhiều người ghi, phải trả lời bằng văn bản ba câu: ai được ghi trường nào, hai ghi khác nhau thì giá trị cuối là gì, và ai sửa khi sai. Không trả lời được thì bảng đó không được dùng chung.

### Số liệu cần nhớ
| Mục | Con số |
|---|---|
| Quorum phổ biến | N=3, W=2, R=2 |
| Ghi chờ majority trong một region | +1–3 ms; liên vùng +50–150 ms |
| Lệch đồng hồ NTP | vài ms trong DC tốt; hàng chục đến trăm ms trên VM cấu hình kém |
| Cassandra repair | khuyến nghị trong mỗi gc_grace_seconds (mặc định 10 ngày) để tombstone không sống lại |
| Bloom/Merkle | Merkle tree so sánh O(log N) nhánh thay vì toàn bộ key |

### Sai lầm hay gặp
- Nói "eventually consistent" như một thiết kế, không nói bao lâu và ai hợp nhất.
- Phát biểu CAP là "chọn 2 trong 3" hoặc gọi Postgres một node là "CA".
- Tin W+R>N là đọc được giá trị mới nhất trong mọi trường hợp (quên sloppy quorum, ghi đồng thời, ghi thất bại một phần).
- Dùng LWW làm mặc định cho dữ liệu nghiệp vụ nhiều người ghi; dùng wall clock để quyết định thứ tự.
- Để ORM/câu lệnh quyết định quy tắc hợp nhất: [[ON CONFLICT DO NOTHING]] là first-writer-wins, [[ON CONFLICT DO UPDATE]] là last-writer-wins — cả hai đều là quyết định nghiệp vụ.
- Dùng CRDT để giữ invariant (không âm, duy nhất) — nó không làm được.
- Đòi strong consistency cho mọi endpoint rồi trả giá latency ở dashboard chỉ cần "số liệu tính đến 5 phút trước".

### Nói thế nào trong phỏng vấn (EN)
- "Linearizability means every read sees the latest completed write as if there were a single copy; eventual consistency only promises convergence, with no bound." — Linearizability như một bản sao duy nhất; eventual chỉ hứa hội tụ.
- "CAP only applies during a partition, so I prefer PACELC: when there is no partition, the real trade-off is latency versus consistency." — CAP chỉ áp dụng khi partition; PACELC nói về latency vs consistency lúc bình thường.
- "With N equals 3, W and R equal 2, reads overlap writes, but sloppy quorums and concurrent writes still break the guarantee." — N=3, W=R=2 giao nhau, nhưng sloppy quorum và ghi đồng thời vẫn phá bảo đảm.
- "Last-writer-wins silently drops acknowledged writes; I would only accept it when each key has a single legitimate writer." — LWW âm thầm bỏ ghi đã xác nhận; chỉ chấp nhận khi mỗi key một người ghi.
- "Shared data needs an explicit merge rule; we once leaked data across tenants because an upsert silently implemented first-writer-wins." — Dữ liệu dùng chung cần quy tắc hợp nhất rõ; từng leak cross-tenant vì upsert ngầm là first-writer-wins.
`,
  apply: `
### Áp dụng vào hệ thống SBOM của bạn
- Làm bảng "dataset dùng chung" trong một buổi: [[t_components]] (mọi tenant), DB vulnerability qua FDW, cache enrichment trên Redis dùng chung giữa các Lambda, kết quả ClearlyDefined ghi lại. Với mỗi dòng trả lời: ai ghi, quy tắc khi hai ghi khác nhau, mức nhất quán mong đợi, cách sửa lệch. Đây là tài liệu đáng lẽ đã chặn sự cố #15.
- Sự cố #15 đã fix bằng overlay per-tenant (PRCL là chân lý của Target Details, [[t_components]] chỉ là view). Hoàn thiện: grep toàn repo các [[ON CONFLICT DO NOTHING]] và [[ON CONFLICT DO UPDATE]] trên bảng dùng chung, ghi cạnh mỗi câu lệnh quy tắc hợp nhất có chủ đích (first/last-writer hay merge theo nguồn).
- License có hai nguồn: declared (từ file của tenant) và discovered (ClearlyDefined, dùng chung). Viết quy tắc ưu tiên **theo nguồn**, không theo thời gian ghi: tenant declared ghi đè discovered trong view tenant; discovered chỉ cập nhật shared. Đây là một "merge theo trường", không phải LWW.
- Write-back license từ enrichment về [[t_components]] đang là one-shot/best-effort (ticket 1862): đó là eventual consistency không có anti-entropy. Thêm sweeper so sánh PRCL với view tenant theo lô mỗi đêm và sửa lệch — bản Merkle tree thủ công: so hash theo nhóm 1000 component rồi chỉ đi sâu vào nhóm lệch.
- Redis L1 cache của Lambda: khi Lambda mất REDIS_HOST (sự cố #2) cache tắt im lặng và kết quả vẫn đúng, chỉ chậm — tốt, vì cache là eventual có TTL. Nhưng nếu cache giữ kết quả lỗi ([[cd_fetch_error]]) với TTL dài thì lỗi lan sang mọi tenant: cache lỗi phải TTL ngắn hoặc không cache.
- Phân mức nhất quán theo endpoint và ghi vào tài liệu API: trạng thái upload = read-your-writes (đọc writer); Target Details = nhất quán với PRCL; dashboard metrics và distribution = eventual, hiển thị "tính đến hh:mm" (ticket 3214 chính là người dùng không được báo cửa sổ eventual này).
- Không có nơi nào trong SBOM cần CRDT hay multi-leader; ghi điều này để không ai mang Cassandra vào vì "scale".
`,
  quiz: [
    { t: 'mc', q: 'Client A ghi x=1 và nhận OK lúc T. Client B đọc lúc T+10 ms và nhận x=0. Hệ này KHÔNG thoả mức nào?', o: ['Eventual consistency', 'Linearizability', 'Monotonic reads của B', 'Read-your-writes của A'], a: 1, why: 'Linearizability yêu cầu mọi đọc sau khi ghi hoàn tất theo thời gian thực phải thấy ghi đó; eventual và các session guarantee của B/A không bị vi phạm chỉ bởi ví dụ này.' },
    { t: 'mc', q: 'Phát biểu nào về CAP là đúng?', o: ['Mọi hệ phải chọn 2 trong 3 thuộc tính C, A, P', 'Postgres một node là hệ CA', 'Chỉ khi có network partition hệ mới phải chọn giữa trả lời dữ liệu có thể cũ (A) và từ chối/chờ (C); lúc bình thường trade-off là latency vs consistency', 'Hệ AP không bao giờ trả dữ liệu mới nhất'], a: 2, why: 'P là thực tế, không phải lựa chọn; CAP chỉ nói về lúc partition, PACELC bổ sung phần còn lại.' },
    { t: 'mc', q: 'Hệ leaderless N=3, W=2, R=2 nhưng đọc vẫn thỉnh thoảng trả giá trị cũ dù ghi đã OK. Nguyên nhân hợp lý?', o: ['Bloom filter false positive', 'Sloppy quorum: ghi được chấp nhận trên node ngoài tập N chính thức qua hinted handoff, nên tập đọc không giao với tập ghi', 'Merkle tree chưa được xây', 'R phải lớn hơn W'], a: 1, why: 'W+R>N chỉ bảo đảm giao nhau khi ghi nằm trong N node nhà; sloppy quorum đổi bảo đảm đó lấy tính sẵn sàng.' },
    { t: 'mc', q: 'Hai bản của cùng key có version vector {A:2, B:1} và {A:1, B:2}. Hệ nên làm gì?', o: ['Giữ bản {A:2, B:1} vì tổng lớn hơn', 'Giữ bản có timestamp mới hơn', 'Giữ cả hai như siblings vì chúng đồng thời, để client hợp nhất và ghi lại với vector {A:2, B:2}', 'Xoá cả hai và yêu cầu ghi lại'], a: 2, why: 'Mỗi vector có một thành phần lớn hơn nên không bản nào thay thế được bản kia; đó là định nghĩa xung đột đồng thời.' },
    { t: 'mc', q: 'Yêu cầu: tập tag của một component được nhiều người thêm/xoá đồng thời, offline cũng được. CRDT nào phù hợp?', o: ['G-counter', 'LWW-register chứa cả mảng tag', 'PN-counter', 'OR-set (observed-remove set)'], a: 3, why: 'OR-set cho add và remove đồng thời hội tụ với add thắng; LWW-register trên cả mảng sẽ mất tag của một bên.' },
    { t: 'fill', q: 'Điền: cây hash theo khoảng key dùng để so sánh nhanh dữ liệu giữa hai replica trong anti-entropy gọi là ___ tree.', a: ['merkle', 'merkle tree', 'hash'], why: 'Merkle tree chỉ truyền nhánh có hash khác nhau nên so sánh hàng triệu key với O(log N) trao đổi.' },
    { t: 'fill', q: 'Điền: kiểu dữ liệu nhân bản mà các bản sao hội tụ tự động khi merge mà không cần điều phối gọi là ___.', a: ['crdt', 'conflict-free replicated data type', 'conflict free replicated data type'], why: 'CRDT dựa trên phép merge giao hoán, kết hợp, luỹ đẳng; giải quyết hội tụ chứ không giải quyết invariant.' },
    { t: 'open', q: 'A table is shared by all tenants and several of them write to the same row. How do you define and enforce the consistency and merge rules so no tenant sees another tenant data?', a: 'Tách dữ liệu thành fact dùng chung bất biến (định danh, dữ liệu từ nguồn công khai) và quan sát theo tenant lưu trong overlay per-tenant; view của tenant là overlay ghi đè shared. Viết quy tắc hợp nhất theo nguồn và theo trường thay vì first-writer hay last-writer-wins ngầm qua upsert. Mọi câu lệnh ghi vào bảng chung phải khai báo quy tắc đó; thêm anti-entropy định kỳ so sánh và sửa lệch. Mức nhất quán của từng endpoint được ghi rõ: dữ liệu tenant là read-your-writes, dữ liệu dẫn xuất là eventual có hiển thị thời điểm.', keys: ['first-writer-wins', 'overlay', 'per-tenant', 'merge rule', 'anti-entropy'] }
  ]
},
];
