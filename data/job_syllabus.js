/* ===== Tab Job: bản đồ kiến thức cần học theo từng kỹ năng của JD ===== */
window.JOB = window.JOB || {};
window.JOB.syllabus = [
{ area: 'Node.js runtime', prio: 1, why: 'JD yêu cầu Node.js là backend chính; câu hỏi về event loop gần như chắc chắn xuất hiện ở vòng technical.', lessons: ['J1'], related: ['F4', 'K1', 'K2', 'K6'], concepts: [
  'Event loop: các phase timers, poll, check; microtask (Promise, process.nextTick) chạy trước macrotask',
  'libuv thread pool: việc nào chạy ở pool (fs, crypto, dns.lookup), UV_THREADPOOL_SIZE mặc định 4',
  'Vì sao chặn event loop làm cả server đứng; cách đo event loop lag',
  'async/await: lỗi quên await, Promise.all vs allSettled vs race, unhandled rejection',
  'Streams và backpressure: pipeline, highWaterMark, đọc file lớn không nạp hết vào RAM',
  'worker_threads vs cluster vs chạy nhiều container: khi nào dùng cái nào',
  'Bộ nhớ V8: heap, --max-old-space-size, rò rỉ do listener/closure/cache không giới hạn',
  'Huỷ tác vụ bằng AbortController/AbortSignal (tương đương context của Go)',
  'Graceful shutdown: SIGTERM, server.close, đóng pool DB và consumer',
  'Đối chiếu goroutine/channel/context của Go với Promise, EventEmitter, AbortSignal, p-limit'
], practice: 'Viết một endpoint chạy vòng lặp CPU 2 giây, đo event loop lag, rồi chuyển sang worker_threads và đo lại.' },

{ area: 'TypeScript', prio: 1, why: 'Code backend và frontend đều bằng TypeScript; người phỏng vấn thường hỏi type system và cách validate dữ liệu ở biên.', lessons: ['J2'], related: ['K4'], concepts: [
  'tsconfig strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes và lỗi chúng bắt được',
  'type vs interface; union, intersection, literal type',
  'Discriminated union + kiểm tra exhaustive bằng never',
  'Generics có ràng buộc (extends, keyof) và utility types (Partial, Pick, Omit, Record, ReturnType, Awaited)',
  'unknown vs any; type guard và assertion function',
  'Type không tồn tại lúc chạy: validate input ở biên bằng zod hoặc class-validator',
  'DTO vs entity vs domain type: tách để API không lộ cấu trúc DB',
  'enum vs union literal; vì sao nhiều team bỏ enum',
  'Xử lý lỗi: subclass Error có cause, Result type vs throw',
  'ESM vs CommonJS, path alias, build bằng tsc/swc, ESLint + Prettier, TSDoc'
], practice: 'Bật strict cho một service trong dcn_toolbox, sửa hết lỗi, ghi lại 3 bug thật mà compiler bắt được.' },

{ area: 'NestJS', prio: 1, why: 'Framework được JD nêu tên (1–3 năm); dễ có bài live coding hoặc bài về nhà viết API bằng NestJS.', lessons: ['J3'], related: ['F6', 'K4'], concepts: [
  'Module, provider, controller; cách DI container giải quyết dependency',
  'Scope của provider: singleton, request, transient và cái giá của request scope',
  'Vòng đời request: middleware → guard → interceptor → pipe → handler → interceptor → exception filter',
  'ValidationPipe + DTO class-validator; whitelist, transform',
  'Guard cho xác thực JWT, phân quyền theo role và tenant',
  'Interceptor cho logging, timeout, cache; exception filter cho error contract thống nhất',
  'ConfigModule và validate biến môi trường lúc khởi động',
  'ORM trong Nest (TypeORM, Prisma, Mongoose): transaction, tránh N+1',
  'Cron (@nestjs/schedule) khi chạy nhiều instance; queue BullMQ hoặc RabbitMQ transport',
  'Health check với terminus; Swagger tự sinh từ decorator',
  'Testing: Test.createTestingModule, override provider, e2e bằng Supertest'
], practice: 'Viết module booking có guard, pipe, interceptor timeout và e2e test; so với cách bạn làm cùng việc đó bằng Go.' },

{ area: 'React', prio: 2, why: 'Full-stack nghĩa là bạn sẽ tự làm giao diện; câu hỏi React thường xoáy vào render, hooks và quản lý state.', lessons: ['J4'], related: [], concepts: [
  'Mô hình render: state đổi → render lại cây con; reconciliation và vai trò của key',
  'useEffect: khi nào cần, dependency array, cleanup; vì sao không nên fetch trong effect',
  'useMemo/useCallback/memo: khi nào thật sự giúp, khi nào chỉ thêm phức tạp',
  'Phân loại state: server state (TanStack Query, SWR), client state, URL state, form state',
  'Context vs store (Zustand, Redux Toolkit) và cách tránh re-render toàn cây',
  'Form + validation dùng chung schema zod với backend',
  'Danh sách lớn: virtualization; lazy loading component',
  'Error boundary, Suspense',
  'Accessibility cơ bản: semantic HTML, label, focus, điều hướng bằng bàn phím',
  'CSS: responsive, CSS modules hoặc Tailwind'
], practice: 'Làm form tạo booking có validation zod và danh sách booking dùng TanStack Query, có trạng thái loading/error rõ ràng.' },

{ area: 'Next.js App Router', prio: 1, why: 'JD nêu Next.js; bạn đã có kinh nghiệm sửa Next.js thật nên đây là chỗ ghi điểm nếu nói được rendering và caching.', lessons: ['J5'], related: ['B1', 'F7'], concepts: [
  'Server Components vs Client Components; ranh giới use client và cái gì không chạy được ở server',
  'SSR, SSG, ISR, streaming với Suspense/loading.tsx: chọn cho từng loại trang',
  'Data fetching và caching: revalidate theo thời gian, revalidatePath, revalidateTag',
  'Route Handlers vs Server Actions vs gọi API backend riêng (BFF)',
  'Middleware/proxy cho auth redirect, i18n',
  'Hydration mismatch: nguyên nhân (thời gian, random, extension/dịch trình duyệt sửa DOM) và cách sửa',
  'Biến NEXT_PUBLIC được bake lúc build; cấu hình runtime phải làm cách khác',
  'Gọi API phía server bằng hostname nội bộ, không qua domain public',
  'next/image, metadata/SEO, Core Web Vitals (LCP, INP, CLS)',
  'Build output standalone + Docker; nâng cấp khi có CVE'
], practice: 'Làm 3 trang: lịch tàu public (ISR), tra cứu container (dynamic), dashboard đăng nhập (client); giải thích lý do chọn cho từng trang.' },

{ area: 'Testing nhiều tầng', prio: 1, why: 'JD liệt kê đủ unit, integration, UAT, automation regression: chắc chắn bị hỏi chiến lược test và có thể phải viết test khi làm bài.', lessons: ['J6'], related: ['K8'], concepts: [
  'Test pyramid/trophy: tỉ lệ và mục đích từng tầng',
  'Unit test với Jest hoặc Vitest: test hành vi, mock vừa đủ',
  'Integration test API với Supertest + Testcontainers (DB thật trong Docker)',
  'Test NestJS module bằng override provider',
  'Component test với React Testing Library: query theo role, user-event',
  'E2E với Playwright: trace, retry, xử lý flaky test',
  'Contract test giữa frontend và BFF',
  'UAT: acceptance criteria Given/When/Then, môi trường và dữ liệu UAT, vai trò của dev',
  'Automation regression: smoke trên mỗi PR, full suite nightly; viết test cho mỗi bug đã sửa',
  'Coverage: ý nghĩa và giới hạn; quality gate trong CI (lint, type-check, test, công cụ phân tích)'
], practice: 'Cho dự án luyện tay: 5 unit test, 2 integration test bằng Testcontainers, 1 Playwright smoke test chạy trong CI.' },

{ area: 'SQL và NoSQL (Postgres, MongoDB, Redis, Cassandra)', prio: 1, why: 'JD đòi cả lập trình và thiết kế DB quan hệ lẫn phi quan hệ; Cassandra là phần bạn chưa có.', lessons: ['J7'], related: ['F5', 'K3', 'B4', 'F7', 'B3'], concepts: [
  'SQL: index B-tree, composite index, transaction, isolation level, N+1, EXPLAIN',
  'Chọn DB theo access pattern: khi nào bắt buộc dùng DB quan hệ (booking, tiền, ràng buộc)',
  'MongoDB: embed vs reference, index compound, aggregation pipeline, transaction đa tài liệu',
  'Redis: cache-aside, TTL, eviction, rate limit, distributed lock, sorted set',
  'Cassandra: thiết kế theo truy vấn, partition key + bucket theo thời gian, clustering order',
  'Cassandra: consistency level ONE/QUORUM, tombstone khi xoá, không JOIN',
  'Mô hình dữ liệu mẫu: booking, chuỗi sự kiện container, lịch tàu',
  'ORM trong Node (Prisma, TypeORM, Mongoose) và bẫy hiệu năng',
  'Migration an toàn theo expand-contract'
], practice: 'Thiết kế bảng Cassandra cho sự kiện container với 3 truy vấn chính; viết ra partition key và lý do.' },

{ area: 'REST API và thiết kế hệ thống', prio: 2, why: 'JD nêu RESTful API; vòng system design sẽ dùng nghiệp vụ như tracking, booking, thông báo.', lessons: [], related: ['F6', 'F2', 'F7', 'F8', 'B7', 'C5', 'C16', 'C18'], concepts: [
  'Thiết kế resource, status code, error contract có trace id',
  'Idempotency key cho POST; retry an toàn',
  'Cursor pagination vs offset',
  'Versioning API; OpenAPI/Swagger',
  'Khung làm đề 5 pha: làm rõ yêu cầu, ước lượng, thiết kế tổng thể, đào sâu, tổng kết',
  'Cache, queue, outbox, saga: khi nào cần trong một luồng nghiệp vụ',
  'Bài tương tự trong lộ trình chung: notification (C5), booking (C16), job scheduler (C18)'
], practice: 'Làm mock JM1 (track & trace) lạnh 45 phút trong tab Mock hãng tàu, rồi đọc lời giải tham chiếu.' },

{ area: 'CI/CD, Docker, GCP', prio: 2, why: 'Trách nhiệm "xây và duy trì CI/CD"; GCP và Docker được ưu tiên. Bạn quen AWS nên cần bảng ánh xạ.', lessons: ['J8'], related: ['B18', 'K7'], concepts: [
  'Pipeline chuẩn: lint → type-check → unit → build image → integration/e2e → scan → staging → smoke → production',
  'GitHub Actions hoặc Cloud Build: cache dependency, chạy service container cho test',
  'Dockerfile multi-stage cho NestJS và Next.js standalone; chạy non-root',
  'Pin image theo tag cố định hoặc digest',
  'Rolling, blue-green, canary và cách rollback',
  'Ánh xạ AWS → GCP: Cloud Run, GKE, Cloud SQL, Memorystore, Pub/Sub, Cloud Storage, Artifact Registry, Secret Manager',
  'Cloud Run: concurrency, min instances, cold start, timeout',
  'Workload Identity thay key file; secret qua Secret Manager',
  'Log JSON vào Cloud Logging, metric và alert cơ bản'
], practice: 'Viết workflow GitHub Actions cho dự án luyện tay và deploy thử lên Cloud Run free tier.' },

{ area: 'Nguyên lý lập trình, design pattern, code có tài liệu', prio: 2, why: 'JD nêu programming principles và design pattern; câu "pattern bạn dùng gần đây" rất hay gặp.', lessons: ['J9'], related: ['K4', 'K11'], concepts: [
  'SOLID với ví dụ TypeScript/NestJS',
  'DRY, KISS, YAGNI và khi nào nên phá luật',
  'Composition over inheritance',
  'Strategy, Factory, Adapter, Observer, Decorator, Repository, Builder: mỗi cái một ví dụ nghiệp vụ',
  'Clean/hexagonal architecture trong Nest: domain không phụ thuộc framework',
  'Code review checklist',
  'Tài liệu: README, TSDoc, ADR, Swagger, changelog'
], practice: 'Chuẩn bị 3 pattern bạn đã dùng thật (Go hoặc TS), mỗi cái kể được trong 1 phút: vấn đề, pattern, kết quả.' },

{ area: 'NFR, xử lý sự cố, Agile', prio: 2, why: 'Phần trách nhiệm của JD có NFR, sự cố, technical backlog, roadmap, rủi ro, feedback: đây là thế mạnh để bạn dẫn dắt vòng manager.', lessons: ['J10'], related: ['F9', 'B14', 'B17', 'K9', 'K10'], concepts: [
  'Biến NFR thành số đo: p95, SLO, error budget, checklist bảo mật',
  'Quy trình sự cố: phát hiện → khoanh vùng → giảm nhẹ → sửa gốc → postmortem',
  'Playbook 30 phút đầu khi API Node chậm',
  'Technical backlog: định lượng nợ kỹ thuật, ưu tiên theo rủi ro × chi phí',
  'Ước lượng: chia nhỏ, khoảng tin cậy, spike khi chưa chắc',
  'Risk register: khả năng × tác động, phương án giảm nhẹ',
  'Feedback theo khung SBI; làm việc với stakeholder và khách Nhật',
  'Vai trò của dev trong các buổi Scrum'
], practice: 'Viết 2 câu chuyện STAR (một sự cố, một cải thiện NFR) vào mục Behavioral và tập kể dưới 2 phút.' }
];
