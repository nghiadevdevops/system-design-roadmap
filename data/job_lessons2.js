/* ===== Tab Job OTS · Bài học J4–J6: React, Next.js App Router, chiến lược test full-stack ===== */
window.LESSONS_J2 = [
{ id: 'J4', type: 'job', topic: 'frontend', title: 'React cho full-stack: render, state, hiệu năng', time: '120 phút',
  goal: 'Giải thích được vì sao một component render lại, chọn đúng chỗ đặt từng loại state (server/URL/form/client) và sửa được 3 lỗi useEffect kinh điển, kèm cách đo trước khi tối ưu.',
  md: `
### Vấn đề cần giải
Cổng khách hàng của hãng tàu có ba kiểu màn hình điển hình: danh sách booking có lọc/sort, trang tracking container với timeline hàng trăm đến hàng nghìn sự kiện (gate-in, loaded, departed, discharged...), và form booking 15+ trường có ràng buộc chéo (cảng đi khác cảng đến, số lượng theo loại container). Phỏng vấn React gần như chắc chắn hỏi ba câu: *vì sao component này render lại*, *đặt state ở đâu*, *useEffect dùng sai thế nào*. Với dev backend, mô hình cần nắm là **UI = f(state)**: bạn không sửa DOM, bạn đổi state và React tính lại. Hiểu sai chỗ này là gốc của phần lớn bug React: dữ liệu cũ, render vô tận, form gõ bị giật.

### Mô hình render
- **Trigger** chỉ có 3 nguồn: [[setState]] của chính component, component cha render lại, hoặc **context** mà nó đọc đổi giá trị. Props "đổi" không phải trigger riêng: cha render thì mọi con render theo, trừ khi con bọc [[React.memo]] và props bằng nhau theo [[Object.is]].
- **Render** = gọi hàm component để ra cây element mới (thuần JS, khá rẻ). **Commit** = áp phần khác biệt lên DOM (đắt hơn). Render lại không có nghĩa là DOM đổi.
- **Reconciliation** (đối chiếu cây cũ và mới): cùng vị trí + cùng type thì giữ instance và state, chỉ cập nhật props; khác type (component A thành B, [[div]] thành [[section]]) thì unmount cả cây con và **mất state**.
- **key** cho React biết item nào là item nào giữa hai lần render. Dùng index làm key khi danh sách có chèn/xoá/sort thì state và DOM (ô input, checkbox) "dính" sang item khác. Dùng id ổn định như [[bookingNo]]. Đổi key có chủ đích là cách reset state: [[key={bookingNo}]] cho form chi tiết.
- **Batching**: nhiều [[setState]] trong cùng một event (kể cả trong promise, timeout từ React 18) gộp thành một lần render.
- **Ngân sách**: 60 fps tức ~16 ms mỗi frame; task JS trên 50 ms là *long task*, làm tương tác khựng và kéo INP (Interaction to Next Paint) xấu đi.
- **StrictMode** ở dev cố ý render 2 lần và chạy effect mount → cleanup → mount để lộ effect thiếu cleanup. Thấy request gọi 2 lần ở dev là tín hiệu kiểm tra cleanup, không phải bug của React.

### Hooks và những lần dùng sai
| Hook | Dùng để | Dùng sai hay gặp |
|---|---|---|
| useState | state cục bộ của component | lưu giá trị suy ra được từ props/state khác (derived state) → hai nguồn sự thật lệch nhau |
| useEffect | **đồng bộ với hệ thống bên ngoài**: WebSocket, timer, DOM API, thư viện không phải React | fetch thủ công không huỷ, tính derived state, thiếu dependency, quên cleanup |
| useMemo, useCallback | giữ **tham chiếu ổn định** cho con bọc memo hoặc deps của effect; phép tính đo được trên ~1 ms | bọc mọi thứ "cho chắc": thêm chi phí so sánh, code khó đọc, không nhanh hơn |
| useRef | giá trị mutable không gây render: DOM node, timer id, AbortController, giá trị lần trước | đọc/ghi [[ref.current]] trong lúc render để "lách" state → UI không cập nhật |
| custom hook | đóng gói logic có state để dùng lại: [[useBooking]], [[useDebounce]] | tưởng hook chia sẻ state: mỗi lần gọi là một state riêng |
Dependency array phải liệt kê **mọi giá trị reactive** đọc trong effect (bật rule [[react-hooks/exhaustive-deps]]). Nếu đủ deps mà effect chạy quá nhiều thì lỗi nằm ở thiết kế (object/hàm tạo mới mỗi render), không phải ở chỗ bỏ bớt deps.
~~~tsx
// SAI: thiếu bookingNo trong deps, không huỷ request → đổi booking nhanh thì response cũ ghi đè response mới (race)
useEffect(() => {
  fetch('/api/bookings/' + bookingNo).then(r => r.json()).then(setBooking);
}, []);

// Nếu buộc tự fetch: deps đủ + cleanup huỷ request cũ
useEffect(() => {
  const ac = new AbortController();
  fetch('/api/bookings/' + bookingNo, { signal: ac.signal })
    .then(r => r.json())
    .then(setBooking)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });
  return () => ac.abort();
}, [bookingNo]);

// TỐT NHẤT: giao server state cho TanStack Query (cache, dedupe, retry, huỷ, refetch khi focus lại tab)
function useBooking(bookingNo: string) {
  return useQuery({
    queryKey: ['booking', bookingNo],
    queryFn: ({ signal }) => getJson<Booking>('/api/bookings/' + bookingNo, signal),
    staleTime: 30_000, // 30 s coi là "tươi", tương tự TTL của cache-aside
  });
}
~~~

### Phân loại state trước khi chọn công cụ
| Loại state | Ví dụ ở cổng hãng tàu | Công cụ | Lý do |
|---|---|---|---|
| Server state | danh sách booking, sự kiện container, lịch tàu | TanStack Query hoặc SWR | đây là **cache** của dữ liệu server: cần stale-while-revalidate, dedupe, invalidate sau mutation |
| URL state | bộ lọc POL/POD, trang, sort, tab | search params của router | gửi link cho đồng nghiệp, nút Back hoạt động, reload không mất |
| Form state | form booking 15+ trường | react-hook-form + zod | input uncontrolled: gõ phím không render lại cả form |
| Client/UI state | modal mở, sidebar, theme, nháp chưa lưu | useState, Zustand | chỉ tồn tại ở trình duyệt |
Sai lầm kinh điển: copy server state vào Redux/Zustand. Bạn có hai bản dữ liệu, tự viết loading/error/refetch, và luôn có lúc stale.

### Lifting state, Context hay store
| Cách | Khi nào | Giá phải trả |
|---|---|---|
| Lifting state lên cha chung | 2–3 component gần nhau cần cùng state | prop drilling khi phải đi qua 3+ tầng trung gian |
| Context | giá trị **ít đổi**, đọc ở nhiều nơi: user, locale, theme, feature flag | mọi consumer render lại khi value đổi; không có selector |
| Zustand | client state chia sẻ rộng, đổi thường xuyên | thêm một dependency nhỏ; selector giúp chỉ component đọc slice đó render lại |
| Redux Toolkit | app lớn nhiều team, cần devtools, middleware, quy ước chặt | boilerplate nhiều hơn; RTK Query nếu muốn gộp cả server state |

### Tránh re-render thừa: đo trước, sửa theo thứ tự rẻ → đắt
1. **Đo**: React DevTools Profiler (bật highlight updates) hoặc react-scan ở dev. Chỉ sửa component render lâu hoặc render quá nhiều lần.
2. **Đẩy state xuống** gần nơi dùng (colocation): ô tìm kiếm tự giữ state thay vì để ở cấp trang.
3. **Truyền children**: phần tử con tạo ở cha truyền qua [[children]] không render lại khi state của wrapper đổi.
4. **Chia nhỏ context**: tách filter khỏi user, tách value khỏi setter, memo object value.
5. **React.memo + useCallback/useMemo** cho con nặng (bảng, biểu đồ) khi props thật sự ổn định. React Compiler (opt-in) tự chèn memo lúc build: biết là có, đừng chờ nó cứu một thiết kế state tồi.
6. **Danh sách lớn**: 5 000 sự kiện × ~10 node DOM mỗi dòng = 50 000 node, cuộn sẽ giật. **Virtualization** (TanStack Virtual, react-window) chỉ giữ ~30 dòng đang thấy + overscan trong DOM. Kết hợp cursor pagination ở API: đừng tải 5 000 dòng khi người dùng chỉ xem 50.

### Form + validation: một schema zod cho cả Next.js và NestJS
~~~tsx
// packages/shared/booking.schema.ts: import ở cả form React và ValidationPipe của NestJS
export const BookingSchema = z.object({
  pol: z.string().length(5),              // UN/LOCODE, ví dụ VNSGN
  pod: z.string().length(5),
  containerType: z.enum(['20GP', '40GP', '40HC']),
  quantity: z.coerce.number().int().min(1).max(50), // input HTML luôn trả string → coerce
}).refine(b => b.pol !== b.pod, { message: 'POL và POD phải khác nhau', path: ['pod'] });
export type BookingInput = z.infer<typeof BookingSchema>;

// BookingForm.tsx
const { register, handleSubmit, formState: { errors } } =
  useForm<BookingInput>({ resolver: zodResolver(BookingSchema) });
<label htmlFor="pod">Cảng đến (POD)</label>
<input id="pod" {...register('pod')} aria-invalid={!!errors.pod} aria-describedby="pod-err" />
{errors.pod && <p id="pod-err" role="alert">{errors.pod.message}</p>}
~~~
Validate ở client là **UX**, validate ở server mới là **bảo mật**: luôn chạy lại cùng schema ở NestJS.

### Accessibility, CSS, error boundary
- **Semantic HTML**: [[button]] thay vì [[div onClick]] (có sẵn focus, Enter/Space, role); mỗi input có [[label]]; heading đúng thứ bậc; [[aria-live]] cho thông báo "ETA vừa cập nhật". **Focus**: modal giữ focus bên trong và trả focus về nút mở khi đóng; không xoá outline.
- **CSS**: CSS Modules (class scoped, không tốn runtime) hoặc Tailwind (utility + design token). CSS-in-JS kiểu runtime không hợp Server Components. Responsive mobile-first: bảng tracking 8 cột trên điện thoại chuyển thành dạng card.
- **Error boundary** bắt lỗi khi render của cây con và hiện fallback; *không* bắt lỗi trong event handler hay async (tự try/catch, hoặc để TanStack Query giữ error). Đặt theo vùng: widget timeline lỗi thì chỉ widget đó hiện "Không tải được", cả dashboard không trắng trang.

### React 19 ở mức biết
- [[use(promise)]] đọc promise ngay trong render (kết hợp Suspense); [[use(Context)]] được gọi có điều kiện.
- **Actions**: truyền hàm async vào [[form action]]; [[useActionState]] trả state + pending, [[useFormStatus]] cho nút submit biết đang gửi.
- [[useOptimistic]]: hiện kết quả ngay (đánh dấu thông báo ETA đã đọc), tự quay lại nếu server lỗi.
- [[ref]] là prop bình thường, không cần [[forwardRef]] nữa.

### Sai lầm hay gặp
- Dùng index làm key cho danh sách có xoá/sort → ô nhập liệu hiện nhầm dòng.
- Tính derived state bằng useEffect + setState → render 2 lần, có khung hình hiển thị sai. Tính thẳng trong render, nặng thì useMemo.
- Copy dữ liệu API vào store toàn cục rồi tự đồng bộ → stale, bug cache tự chế.
- Một Context khổng lồ ở gốc chứa cả user lẫn filter → gõ một phím, cả app render lại.
- Rải useMemo/useCallback khắp nơi mà chưa từng mở Profiler.
- Render 5 000 dòng không virtualization, hoặc API trả hết không phân trang.
- Chỉ validate ở client; quên [[z.coerce]] nên số lượng luôn "không hợp lệ".
- [[div onClick]] làm nút: không dùng được bằng bàn phím, screen reader không đọc là nút.

### Nói thế nào trong phỏng vấn (EN)
- "I classify state by ownership first: server state goes to TanStack Query, filters live in the URL, and only true UI state stays in React or Zustand." — Phân loại state theo chủ sở hữu trước rồi mới chọn công cụ.
- "useEffect is for synchronizing with external systems, not for deriving data or fetching without a cache." — useEffect để đồng bộ với hệ thống ngoài, không để suy dữ liệu hay fetch thủ công.
- "Before adding memo, I profile, then try moving state down or passing children; memo is the last step." — Đo trước, đẩy state xuống, memo là bước cuối.
- "We share one zod schema between the form and the NestJS pipe, so client and server rules cannot drift." — Một schema dùng chung nên luật client và server không lệch nhau.
- "For a tracking timeline with thousands of events we virtualize and paginate, so only about thirty rows are in the DOM." — Virtualization + phân trang, DOM chỉ còn khoảng 30 dòng.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện có thật**: bạn đã sửa FE Next.js của hệ SBOM (nâng next 16, crash do dịch trình duyệt, react-scan nằm nhầm trong prod dependencies). Kể theo hướng: "tôi đo re-render bằng công cụ, và tôi phân biệt công cụ dev với bundle prod".
- **Chuyển từ Go/backend**: server state = cache-aside phía client; [[staleTime]] ≈ TTL, [[invalidateQueries]] sau mutation ≈ cache invalidation. Interviewer thích nghe dev backend nói React bằng ngôn ngữ cache vì nó cho thấy bạn hiểu bản chất, không thuộc API.
- **Ví dụ số liệu**: bảng component SBOM 45k dòng của project test lớn: nói được vì sao cần server pagination + virtualization thay vì tải hết.
- **Luyện 1** (dcn_toolbox, web đã dùng React 19 + TanStack Query v5): tìm một trang còn fetch trong useEffect hoặc state trùng lặp, chuyển hết sang [[useQuery]], ghi số lần render trước/sau bằng Profiler.
- **Luyện 2**: tạo zod schema chung trong [[libs/]] cho form "thêm host SSH", dùng ở NestJS pipe và react-hook-form; viết 1 test cho refine.
- **Luyện 3**: trang log 10k dòng với TanStack Virtual; đo INP bằng DevTools Performance trước/sau.
- **Học thuộc 3 câu trả lời 60 giây**: vì sao component render lại; khi nào useMemo thật sự cần; Context vs Zustand vs TanStack Query.
`,
  quiz: [
    { t: 'mc', q: 'Component cha gọi setState, component con không nhận prop nào thay đổi và không bọc React.memo. Mặc định điều gì xảy ra?', o: ['Con không render vì props giữ nguyên', 'Con render lại theo cha; React chỉ commit phần DOM khác biệt', 'Con chỉ render lại nếu có useEffect', 'React so sánh DOM thật và bỏ qua toàn bộ cây con'], a: 1, why: 'Cha render thì con render theo. Bỏ qua chỉ khi bọc memo và props bằng nhau theo Object.is; render lại cũng không có nghĩa DOM đổi.' },
    { t: 'mc', q: 'Danh sách booking dùng index làm key. Người dùng xoá dòng đầu, ô ghi chú (input uncontrolled) của dòng thứ hai giờ hiện nội dung của dòng đã xoá. Nguyên nhân?', o: ['React batch nhiều setState thành một', 'StrictMode render 2 lần ở dev', 'Key theo index làm React tái dùng instance và DOM theo vị trí cho một item khác', 'useMemo trả giá trị cache cũ'], a: 2, why: 'Key là danh tính của item. Index đổi theo vị trí nên React ghép nhầm instance; dùng id ổn định như bookingNo.' },
    { t: 'mc', q: 'Trang lịch tàu có bộ lọc POL/POD và số trang; khách muốn gửi link cho đồng nghiệp để mở ra đúng kết quả. Đặt state bộ lọc ở đâu?', o: ['Zustand store toàn cục', 'Context ở layout', 'useState trong trang', 'URL search params'], a: 3, why: 'URL state chia sẻ được, sống qua reload và nút Back; store hay useState đều mất khi mở link mới.' },
    { t: 'mc', q: 'Context ở gốc app chứa { user, filter, setFilter }; gõ một phím trong ô lọc làm cả app render lại. Hướng sửa tốt nhất?', o: ['Tách context (filter riêng, user riêng, setter riêng) hoặc chuyển filter sang store có selector', 'Bọc mọi component trong app bằng React.memo', 'Giữ filter trong useRef để không gây render', 'Lưu filter vào localStorage'], a: 0, why: 'Mọi consumer của một context render lại khi value đổi; chia nhỏ hoặc dùng selector khoanh vùng render. useRef thì UI không cập nhật.' },
    { t: 'mc', q: 'Trường hợp nào useEffect là lựa chọn đúng?', o: ['Tính tổng số container từ danh sách đang có trong state', 'Mở WebSocket nhận sự kiện container và đóng khi unmount', 'Reset form ngay sau khi submit thành công', 'Lọc danh sách booking theo ô tìm kiếm'], a: 1, why: 'Effect dùng để đồng bộ với hệ thống ngoài và cần cleanup. Các việc còn lại tính trong render hoặc làm trong event handler.' },
    { t: 'fill', q: 'Điền: thư viện quản lý server state của TanStack (cache theo queryKey, dedupe, retry, refetch) tên đầy đủ là TanStack ___.', a: ['query', 'react query', 'tanstack query'], why: 'TanStack Query (trước là React Query); SWR là lựa chọn tương tự của Vercel.' },
    { t: 'fill', q: 'Điền: kỹ thuật chỉ render các dòng đang nằm trong viewport của một danh sách dài (còn gọi là windowing) gọi là list ___.', a: ['virtualization', 'virtualisation', 'virtualizing'], why: 'Virtualization giữ DOM ở vài chục dòng thay vì hàng nghìn, giảm thời gian render và cải thiện INP.' },
    { t: 'open', q: 'Interviewer: "Our tracking page gets slow when a booking has thousands of container events. How would you investigate and fix it?" (trả lời 3–5 câu)', a: 'First I measure instead of guessing: React DevTools **Profiler** shows which components re-render and how long each commit takes, and the Performance panel shows long tasks that hurt INP. If the timeline renders all rows, I add **virtualization** so only the visible rows are in the DOM, and switch the API to cursor **pagination** so we do not download thousands of events at once. If unrelated state changes re-render the list, I move state down, split the context, and wrap the heavy row component in **memo** with stable props. Server data goes through TanStack Query with a sensible staleTime to avoid refetch storms. Then I measure again to confirm the improvement.', keys: ['Profiler', 'virtualization', 'pagination', 'memo'] }
  ]
},
{ id: 'J5', type: 'job', topic: 'frontend', title: 'Next.js App Router: rendering, data fetching, caching, deploy', time: '150 phút',
  goal: 'Chọn đúng chiến lược render và cache cho từng trang của một cổng khách hàng hãng tàu, giải thích được ranh giới Server/Client Component, và chỉ ra 4 bẫy deploy Next.js (env bake lúc build, hostname nội bộ, hydration mismatch, CVE) kèm cách phòng.',
  md: `
### Vấn đề cần giải
Một cổng khách hàng hãng tàu có những trang với nhu cầu trái ngược: **lịch tàu public** (cần SEO, traffic cao, dữ liệu đổi vài lần mỗi ngày), **tracking theo booking** (dữ liệu theo từng request, phải mới, phải kiểm quyền), **dashboard khách đã đăng nhập** (tương tác dày, không cần SEO). App Router cho phép chọn chiến lược render và cache **theo từng route, thậm chí từng component**. Chọn sai thì hoặc BFF bị đập ở mọi request, hoặc khách thấy ETA cũ. Nửa sau của bài là những chỗ Next.js khác React thuần và bạn đã dính thật: env bị bake lúc build, hostname gọi API, hydration, CVE.

### Server Components vs Client Components
| Tiêu chí | Server Component (mặc định trong app/) | Client Component ([['use client']]) |
|---|---|---|
| Chạy ở đâu | server, lúc build hoặc lúc request | server (SSR lần đầu) **và** trình duyệt (hydrate) |
| JS gửi xuống client | không | có: cả file và mọi thứ nó import |
| Được làm | [[await]] dữ liệu trực tiếp, đọc secret, gọi DB/BFF nội bộ | useState, useEffect, onClick, window, localStorage |
| Không được làm | hook state/effect, event handler, browser API | đọc secret, [[fs]], driver DB |
- [['use client']] là **ranh giới** (boundary): file đó và cây import của nó vào client bundle. Đẩy ranh giới xuống **lá** (nút, form, biểu đồ), giữ layout và trang là Server Component.
- Server Component render được Client Component và truyền **props serializable** (string, number, object thường, Date, Promise); không truyền hàm thường hay class instance. Client Component nhận Server Component qua [[children]]. Import [['server-only']] trong file chứa secret hoặc truy cập DB: lỡ import từ client thì **lỗi build** thay vì lộ code.

### Chọn chiến lược render cho từng trang
| Trang | Chiến lược | Vì sao |
|---|---|---|
| Trang chủ, giới thiệu dịch vụ, danh sách cảng | Static (SSG) | gần như không đổi, phục vụ thẳng từ CDN |
| Lịch tàu public, ví dụ [[/schedules/VNSGN-SGSIN]] | ISR: revalidate theo thời gian (ví dụ 600 s) + theo tag khi lịch đổi | cần SEO, chịu traffic cao, chấp nhận trễ vài phút |
| Tracking, ví dụ [[/tracking/BKG123456]] | Dynamic SSR, không cache, streaming bằng Suspense | dữ liệu theo request, phải kiểm quyền sở hữu booking, cần mới |
| Dashboard khách | server shell + Client Components + TanStack Query polling | tương tác nhiều, không cần SEO |
| Tải B/L PDF, webhook, endpoint cho đối tác | Route Handler | trả file/JSON, không phải UI |
**Streaming**: [[loading.tsx]] là Suspense boundary tự động cho cả route; bọc riêng phần chậm bằng [[Suspense]] để HTML phần nhanh (thông tin booking) đi trước, phần chậm (timeline từ hệ thống tracking) stream sau. TTFB không còn bằng thời gian của call chậm nhất.
~~~tsx
// app/tracking/[bookingNo]/page.tsx: Server Component, render theo từng request
export default async function TrackingPage({ params }: { params: Promise<{ bookingNo: string }> }) {
  const { bookingNo } = await params;          // Next 15+: params là Promise
  const booking = await getBooking(bookingNo); // fetch no-store tới BFF qua hostname nội bộ
  if (!booking) notFound();
  return (
    <main>
      <BookingHeader booking={booking} />
      <Suspense fallback={<TimelineSkeleton />}>
        <EventTimeline bookingNo={bookingNo} />{/* async Server Component, stream sau */}
      </Suspense>
      <EtaAlertToggle bookingNo={bookingNo} />{/* Client Component nhỏ ở lá */}
    </main>
  );
}
~~~

### Fetch caching và revalidate
- Từ Next 15, [[fetch]] **không cache mặc định** (Next 14 ngược lại, nguồn của nhiều bug "dữ liệu không chịu đổi"). Muốn cache phải nói rõ: [[fetch(url, { next: { revalidate: 600, tags: ['schedule'] } })]]. Next 16 thêm mô hình Cache Components với directive [['use cache']]: đọc release note đúng phiên bản dự án trước khi khẳng định hành vi mặc định.
- **Time-based** đơn giản nhưng dữ liệu có thể cũ tối đa N giây. **On-demand**: [[revalidateTag]] (mọi trang dùng tag) hoặc [[revalidatePath]] (một đường dẫn), gọi từ Server Action/Route Handler khi nguồn đổi.
- **Nhiều replica**: cache ISR mặc định nằm trên đĩa của từng instance → hai pod trả hai phiên bản lịch tàu. Cần cache handler dùng chung (Redis) hoặc để CDN là lớp cache duy nhất.
~~~ts
// app/api/revalidate/route.ts: service lịch tàu gọi webhook này khi một tuyến đổi lịch
import { revalidateTag } from 'next/cache';
export async function POST(req: Request) {
  if (req.headers.get('x-revalidate-secret') !== process.env.REVALIDATE_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const { route } = await req.json();        // ví dụ 'VNSGN-SGSIN'
  revalidateTag('schedule:' + route, 'max'); // Next 16: tham số 2 là cacheLife profile
  return Response.json({ ok: true });
}
~~~

### Route Handler, Server Action hay gọi NestJS BFF
| Cách | Dùng khi | Lưu ý |
|---|---|---|
| Server Action ([['use server']]) | mutation từ form của chính app: bật thông báo ETA, đổi email nhận B/L | thực chất là **endpoint POST công khai**: tự kiểm auth, validate zod, rate limit; không dùng để đọc dữ liệu |
| Route Handler ([[app/api/.../route.ts]]) | webhook, file download, endpoint cho đối tác, revalidate | Server Component **đừng** gọi Route Handler của chính app (thêm một vòng HTTP vô ích): gọi thẳng hàm service |
| NestJS BFF riêng | business logic, tích hợp EDI/API đối tác, nhiều client (web, mobile, đối tác) | Next.js chỉ là lớp trình bày; logic và phân quyền nằm ở BFF, test độc lập |

### Middleware (Next 16 đổi tên file thành proxy)
- Chạy trước mọi request khớp [[matcher]]: redirect về [[/login]] khi thiếu cookie phiên, chọn locale en/ja/vi theo cookie hoặc Accept-Language, gắn CSP nonce. Giữ nó **nhẹ**: không query DB, không gọi chuỗi API.
- **Không phải lớp bảo mật duy nhất**: CVE-2025-29927 (3/2025) cho phép bỏ qua middleware bằng header [[x-middleware-subrequest]]. Quyền phải kiểm lại ở data layer (BFF, Server Action).

### Hydration mismatch: nguyên nhân và cách sửa
Hydration là bước React ở trình duyệt "nhận" HTML server đã render rồi gắn event; lần render đầu ở client phải ra **đúng HTML đó**.
| Nguyên nhân | Ví dụ | Cách sửa |
|---|---|---|
| Giờ/locale khác nhau giữa server và client | server UTC, trình duyệt Asia/Tokyo: ETA 08:00 thành 17:00 | format với timezone cố định (giờ địa phương của cảng) ngay ở server, hoặc render giờ tương đối sau khi mount |
| Giá trị chỉ có ở client trong lúc render | [[typeof window]], [[localStorage]], [[Math.random()]], [[Date.now()]] | đọc trong useEffect rồi set state; [[useId]] để sinh id |
| HTML không hợp lệ | [[div]] trong [[p]], [[table]] thiếu [[tbody]] | sửa markup: trình duyệt tự "vá" DOM nên lệch với cây React |
| Thứ khác sửa DOM | extension, **Google Translate** thay text node bằng thẻ [[font]] | [[translate="no"]] cho vùng React cập nhật liên tục; error boundary khoanh vùng |
Dịch trình duyệt nguy hiểm hơn mismatch thường: nó sửa DOM **sau** hydration, lần cập nhật kế tiếp React gọi [[removeChild]] trên node đã bị thay và văng "The node to be removed is not a child of this node", sập cả cây. [[suppressHydrationWarning]] chỉ dùng cho đúng một node (timestamp), không phải thuốc chữa chung.

### Biến môi trường: thứ gì bị chốt lúc build
| Loại | Đọc được ở | Bị chốt khi nào |
|---|---|---|
| [[NEXT_PUBLIC_*]] | client và server | lúc [[next build]]: giá trị được **thay thẳng vào JS bundle** như hằng số |
| Biến thường, đọc trong code dynamic | chỉ server | lúc runtime, theo env của container |
| Biến thường, đọc trong trang static/ISR | chỉ server | lúc build: HTML đã render sẵn với giá trị đó |
Hệ quả: image build với [[NEXT_PUBLIC_EXPORTER_OTLP_ENDPOINT=localhost]] thì [[docker run -e ...]] giá trị khác **không có tác dụng**. Bạn đã gặp đúng chuyện này: OTel exporter trỏ localhost throw ở mọi lần SSR → **500 toàn site**, sửa env vô ích, phải rebuild. Làm đúng là **build once, deploy many**: không đặt cấu hình theo môi trường vào [[NEXT_PUBLIC_*]]; cấu hình server đọc runtime và validate lúc khởi động (fail fast); cấu hình client cần thì Server Component đọc runtime env rồi truyền qua props; instrumentation phải **fail-open** (exporter lỗi chỉ log, không làm hỏng request).

### Gọi API từ server: hostname nội bộ
Code server (Server Component, Route Handler, Server Action) chạy **trong container FE**. Gọi BFF bằng domain public là đi ra NAT/LB rồi quay về chính host: trên Docker dễ dính **hairpin NAT** và ECONNREFUSED (sự cố login pilot của bạn), lại tốn thêm TLS và một hop LB. Dùng hai base URL: tên service nội bộ cho server, domain public cho trình duyệt.
~~~ts
// lib/env.server.ts: đọc lúc runtime, sai cấu hình thì container chết ngay khi start
import 'server-only';
import { z } from 'zod';
export const env = z.object({
  API_INTERNAL_URL: z.string().url(),                       // http://bff:3000 (service Docker/K8s)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(), // thiếu thì tắt exporter, không throw
  SESSION_SECRET: z.string().min(32),
}).parse(process.env);
~~~

### next/image, metadata, Core Web Vitals
- [[next/image]]: resize theo thiết bị, WebP/AVIF, lazy load; bắt buộc width/height (hoặc fill trong khung có kích thước) nên không gây CLS. Ảnh hero là phần tử LCP thì đánh dấu tải ưu tiên.
- **Metadata API**: [[generateMetadata]] cho trang lịch tàu theo tuyến (title, description, Open Graph), [[sitemap.ts]], [[robots.ts]]; trang tracking và dashboard đặt noindex.
| Chỉ số | Đo gì | Ngưỡng tốt (p75) | Thủ phạm hay gặp |
|---|---|---|---|
| LCP | lúc phần tử lớn nhất hiện ra | ≤ 2,5 s | TTFB chậm, ảnh hero không ưu tiên, font chặn render |
| INP | trễ từ tương tác tới frame kế tiếp | ≤ 200 ms | long task JS, hydrate bundle lớn, render danh sách dài |
| CLS | tổng dịch chuyển layout bất ngờ | ≤ 0,1 | ảnh/iframe không kích thước, banner chèn phía trên, đổi font |
Đo hai kiểu: **lab** (Lighthouse, DevTools Performance) để debug, **field** (thư viện web-vitals hoặc [[useReportWebVitals]] gửi về analytics/OTel) để biết người dùng thật. Quyết định dựa trên p75 của field data.

### Deploy và bảo mật
- [[output: 'standalone']] tạo [[.next/standalone]] gồm [[server.js]] + đúng phần node_modules cần chạy. Tự copy [[public]] và [[.next/static]] vào image (hoặc đẩy static lên CDN), đặt [[HOSTNAME=0.0.0.0]]; multi-stage build, user không phải root, pin phiên bản image Node.
- **Secret không vào client**: ngoài [[NEXT_PUBLIC_*]], props truyền từ Server sang Client Component cũng bị serialize xuống trình duyệt: đừng truyền nguyên object user từ DB, chọn field trước. Server Action phải tự kiểm session và quyền. Header: CSP có nonce, HSTS, [[frame-ancestors]] chống clickjacking.
- **CVE**: next 16.3.1 dính 3 lỗi RCE, bạn đã nâng lên 16.3.8 (cùng minor, rủi ro thấp). Quy trình: Dependabot/Renovate báo → đọc advisory xem có bị ảnh hưởng → nâng patch → CI + smoke E2E → canary → prod.

### Sai lầm hay gặp
- [['use client']] ở layout gốc → cả app thành client, mất lợi ích Server Components.
- Đặt URL theo môi trường vào [[NEXT_PUBLIC_*]] rồi mong đổi được lúc chạy container.
- Server gọi API bằng domain public (hairpin NAT, thêm hop thừa).
- Format ngày giờ theo máy chạy → mismatch; rải [[suppressHydrationWarning]] khắp nơi để "tắt lỗi".
- Server Component fetch Route Handler của chính app; dùng Server Action để đọc dữ liệu; coi middleware là lớp auth duy nhất.
- Chạy nhiều replica mà để cache ISR trên đĩa từng pod → hai khách thấy hai lịch tàu khác nhau.

### Nói thế nào trong phỏng vấn (EN)
- "I default to Server Components and push the 'use client' boundary down to the interactive leaves." — Mặc định Server Component, đẩy ranh giới client xuống lá.
- "Public vessel schedules are ISR with tag-based revalidation; tracking is dynamic per request and streamed with Suspense." — Lịch tàu ISR theo tag, tracking dynamic có streaming.
- "NEXT_PUBLIC variables are inlined at build time, so we build once and read environment config on the server at runtime." — NEXT_PUBLIC bị inline lúc build nên cấu hình môi trường đọc ở server lúc runtime.
- "Server-side calls go to the BFF over the internal network, never through the public hostname." — Gọi từ server đi mạng nội bộ, không qua domain public.
- "We judge performance by p75 Core Web Vitals from real users, not only by a Lighthouse score." — Đánh giá bằng p75 field data, không chỉ điểm Lighthouse.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Sự cố 1 (STAR)**: pilot 500 toàn site sau deploy; đọc log SSR thấy OTel exporter throw; nguyên nhân [[NEXT_PUBLIC_EXPORTER_OTLP_ENDPOINT]] bị bake "localhost" lúc build nên sửa env vô ích, phải rebuild. Bài học kể được: build once, validate env khi start, instrumentation fail-open.
- **Sự cố 2**: login pilot hỏng 100% vì FE server-side gọi API bằng hostname public → Docker hairpin ECONNREFUSED; sửa bằng địa chỉ nội bộ. Nối sang câu "tách API_INTERNAL_URL và URL public".
- **Sự cố 3**: crash do dịch trình duyệt ở Dashboard Notifications, và fix cũ từng bị một PR khác âm thầm đảo ngược. Kể kèm bài học regression test (bài J6).
- **Sự cố 4**: next 16.3.1 có 3 RCE → thử nâng 16.3.8 trên 2 nhánh local, audit Critical 3 → 0 rồi mới đề xuất. Đây là bằng chứng cho mục "security, maintainability" trong JD.
- **Chuyển kiến thức**: web dcn_toolbox chạy Vite; [[import.meta.env.VITE_*]] cũng bị inline lúc build, cùng bản chất với NEXT_PUBLIC. Nói được điểm chung này cho thấy bạn hiểu cơ chế, không thuộc lòng framework.
- **Luyện**: repo nhỏ "vessel-portal": trang lịch tàu theo tuyến dạng ISR + webhook revalidateTag, trang tracking theo booking dynamic + Suspense, đo LCP/CLS bằng Lighthouse; build standalone Docker, chạy 2 replica để tận mắt thấy ISR lệch nhau.
- **Học thuộc**: trả lời "SSR vs SSG vs ISR, chọn cho trang nào" trong 90 giây bằng bảng ở trên.
`,
  quiz: [
    { t: 'mc', q: 'Một component trong app/ dùng useState và onClick nhưng file không có "use client". Điều gì xảy ra?', o: ['Chạy bình thường, Next tự nhận ra đây là Client Component', 'Lỗi build: hook state chỉ dùng được trong Client Component', 'Chạy được nhưng onClick bị bỏ qua im lặng', 'Chỉ có cảnh báo trong console ở dev'], a: 1, why: 'Mặc định trong App Router là Server Component; dùng useState ở đó Next báo lỗi và yêu cầu đánh dấu "use client".' },
    { t: 'mc', q: 'Image FE build với NEXT_PUBLIC_API_URL=http://localhost:8080. Trên prod chạy container với -e NEXT_PUBLIC_API_URL=https://api.example.com. Code client sẽ gọi đâu?', o: ['https://api.example.com vì env runtime ghi đè', 'Tuỳ trình duyệt của người dùng', 'http://localhost:8080 vì giá trị đã được inline vào bundle lúc build', 'undefined vì Next chỉ đọc env lúc runtime'], a: 2, why: 'NEXT_PUBLIC_* được thay thẳng vào JS lúc next build; đổi env khi chạy container không ảnh hưởng bundle.' },
    { t: 'mc', q: 'Trang lịch tàu public theo tuyến, dữ liệu đổi vài lần mỗi ngày, cần SEO và chịu traffic cao. Chiến lược hợp nhất?', o: ['ISR: revalidate theo thời gian và theo tag khi lịch đổi', 'Client-side fetch trong useEffect', 'Dynamic SSR mỗi request, không cache', 'SSG build một lần, deploy lại mỗi khi lịch đổi'], a: 0, why: 'ISR cho HTML cache được (SEO, chịu tải) mà vẫn cập nhật khi nguồn đổi; SSR mỗi request đập BFF, SSG phải deploy lại.' },
    { t: 'mc', q: 'Lỗi hydration chỉ xuất hiện với người dùng ở Nhật, và giờ ETA hiển thị nhảy sau khi trang tải xong. Nguyên nhân khả dĩ nhất?', o: ['Thiếu key trong danh sách sự kiện', 'CDN cache nhầm HTML của tuyến khác', 'Server Component gọi BFF quá chậm', 'Format giờ theo timezone của máy: server UTC, trình duyệt Asia/Tokyo nên HTML server khác lần render đầu ở client'], a: 3, why: 'Hydration yêu cầu lần render đầu ở client khớp HTML server; format giờ theo timezone máy chạy là nguyên nhân kinh điển.' },
    { t: 'mc', q: 'FE container gọi BFF qua https://portal.example.com (domain public trỏ về chính host đó); chỉ các lời gọi phía server bị ECONNREFUSED. Cách sửa đúng?', o: ['Gọi bằng hostname nội bộ (tên service Docker/K8s) qua một biến runtime riêng cho server', 'Tăng timeout của fetch lên 30 s', 'Chuyển mọi lời gọi API sang client', 'Tắt TLS cho lời gọi nội bộ'], a: 0, why: 'Đây là hairpin NAT: từ trong mạng nội bộ đi ra IP public rồi quay về chính host. Server nên gọi BFF qua mạng nội bộ.' },
    { t: 'fill', q: 'Điền: trong next.config, tuỳ chọn output: "___" tạo thư mục chứa server.js và phần node_modules tối thiểu để đóng Docker image gọn.', a: ['standalone'], why: 'output standalone; nhớ tự copy public và .next/static vào image.' },
    { t: 'fill', q: 'Điền: chỉ số Core Web Vitals đo độ phản hồi của tương tác (thay FID từ 2024), ngưỡng tốt ≤ 200 ms, viết tắt là ___.', a: ['inp', 'interaction to next paint'], why: 'INP = Interaction to Next Paint; LCP ≤ 2,5 s và CLS ≤ 0,1 là hai chỉ số còn lại.' },
    { t: 'open', q: 'Interviewer: "Design the rendering strategy for our customer portal: public vessel schedules, booking tracking, and a logged-in dashboard." (trả lời 3–5 câu)', a: 'Vessel schedules are public and SEO-relevant, so I would use **ISR** with a time-based revalidate as a safety net and **revalidateTag** triggered by a webhook when a route schedule changes. Booking tracking is per-request and needs ownership checks, so it is **dynamic** with no caching; the booking header renders first and the slow event timeline streams inside **Suspense**. The dashboard keeps a server-rendered shell while the interactive widgets are a **Client Component** tree using TanStack Query polling. All server-side calls go to the NestJS BFF over the internal hostname, and with several replicas I would use a shared cache handler so ISR pages stay consistent.', keys: ['ISR', 'revalidateTag', 'dynamic', 'Suspense', 'Client Component'] }
  ]
},
{ id: 'J6', type: 'job', topic: 'testing', title: 'Chiến lược test full-stack: unit, integration, UAT, regression tự động', time: '150 phút',
  goal: 'Thiết kế được chiến lược test nhiều tầng cho một service NestJS + Next.js (tầng nào test gì, công cụ, tỉ lệ, chạy lúc nào trong CI), viết được integration test với DB thật và giải thích cách xử lý flaky test, UAT và quality gate.',
  md: `
### Vấn đề cần giải
JD của OTS ghi rõ: kỹ năng test **unit, integration, UAT, automation regression** và tham gia QA "với quy trình và công cụ phân tích". Người phỏng vấn không hỏi "bạn có viết test không" mà hỏi **test cái gì ở tầng nào, chạy lúc nào, vì sao tin vào kết quả**. Bạn có sẵn bằng chứng ngược: ở hệ SBOM, ít nhất hai bản fix (crash do dịch trình duyệt, giới hạn 7 ngày của audit export) đã bị PR của ticket khác **âm thầm đảo ngược** và chỉ lộ ra khi khách báo lại. Không có regression test gắn với bug thì fix chỉ là tạm thời. Mục tiêu của chiến lược test: **mua nhiều độ tin cậy nhất cho mỗi phút CI**.

### Pyramid hay trophy: các tầng và tỉ lệ
| Tầng | Mục đích | Công cụ Node/React | Tốc độ mỗi test | Tỉ lệ gợi ý |
|---|---|---|---|---|
| Static | lỗi type, lỗi hiển nhiên, style | [[tsc --noEmit]], ESLint | vài giây cả repo | luôn chạy |
| Unit | logic thuần: tính cước, parse sự kiện EDI, state machine trạng thái container | Vitest, Jest | ms | ~50–60% số test |
| Integration | API + DB thật, module NestJS, component + hook + network giả | Supertest + Testcontainers, React Testing Library + MSW | 100 ms – vài s | ~30% |
| Contract | hợp đồng request/response FE ↔ BFF, BFF ↔ đối tác | Pact | nhanh như unit | theo số cặp consumer/provider |
| E2E | vài luồng sống còn qua trình duyệt thật | Playwright | 5–60 s | ~5–10%, chỉ luồng booking/tiền |
| UAT | business xác nhận đúng nghiệp vụ | môi trường UAT, checklist Given/When/Then | thủ công hoặc bán tự động | mỗi release |
Pyramid (nhiều unit nhất) hợp backend nhiều logic; *testing trophy* (nhiều integration nhất) hợp frontend, nơi bug nằm ở chỗ ghép component, network và state. Đừng cãi nhau về hình dạng: đặt test ở **tầng rẻ nhất mà vẫn bắt được loại bug đó**.

### Unit: test hành vi, mock vừa đủ
- Test qua **public API** (input → output, hoặc side effect quan sát được), không assert hàm nội bộ được gọi mấy lần. Refactor bên trong mà test đỏ là test đang khoá implementation.
- Chỉ mock **biên**: HTTP ra ngoài, đồng hồ, random, queue. Mock repository cùng tầng thì test chỉ chứng minh "mock trả đúng thứ tôi bảo nó trả".
- [[vi.useFakeTimers()]] cho retry/backoff và TOTP; [[it.each]] chính là table-driven test của Go.
~~~ts
// eta.spec.ts: quy tắc báo khách khi ETA thay đổi (ngưỡng 6 giờ là giả định)
describe('shouldNotifyEtaChange', () => {
  it.each([
    ['2026-10-20T08:00:00Z', '2026-10-20T15:00:00Z', true],  // trễ 7 giờ → báo
    ['2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', false], // trễ 1 giờ → không spam
    ['2026-10-20T08:00:00Z', '2026-10-19T20:00:00Z', true],  // sớm 12 giờ cũng phải báo
  ])('ETA %s → %s thì notify = %s', (oldEta, newEta, expected) => {
    expect(shouldNotifyEtaChange(new Date(oldEta), new Date(newEta))).toBe(expected);
  });
});
~~~

### Integration API: Supertest + Testcontainers + override provider
Chạy **Postgres/Mongo/Redis thật trong Docker** cho mỗi suite (khởi động vài giây, dùng chung trong file, dọn dữ liệu giữa các test bằng truncate hoặc transaction rollback). Không mock DB vì bug thật nằm ở SQL, index, constraint, timeout, migration: FDW đóng băng schema hay statement_timeout 90 s ở cấp role là ví dụ của chính bạn. NestJS cho thay đúng một provider bằng [[overrideProvider]]: giữ cả module thật, chỉ fake client gọi đối tác.
~~~ts
let app: INestApplication;
let pg: StartedPostgreSqlContainer;
beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start(); // pin version giống prod
  process.env.DATABASE_URL = pg.getConnectionUri();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EdiClient).useValue({ pushBooking: vi.fn().mockResolvedValue({ ok: true }) })
    .compile();
  app = mod.createNestApplication();
  await app.init();
}, 60_000);
afterAll(async () => { await app.close(); await pg.stop(); });

it('POST /bookings lặp lại cùng Idempotency-Key chỉ tạo 1 booking', async () => {
  const body = { pol: 'VNSGN', pod: 'SGSIN', containerType: '40HC', quantity: 2 };
  const send = () => request(app.getHttpServer()).post('/bookings').set('Idempotency-Key', 'k-1').send(body);
  const first = await send().expect(201);
  const again = await send();
  expect(again.body.bookingNo).toBe(first.body.bookingNo);
});
~~~

### Component test với React Testing Library
- Query theo cách người dùng nhìn thấy: [[getByRole('button', { name: 'Đặt chỗ' })]], [[getByLabelText]]; tránh class CSS và [[data-testid]] trừ khi hết cách. Query theo role đồng thời là một bài kiểm tra accessibility.
- [[userEvent]] mô phỏng gõ/click thật (focus, blur, từng ký tự) thay cho [[fireEvent]]; giả network ở tầng HTTP bằng **MSW** để component chạy đúng code fetch thật.
~~~tsx
it('báo lỗi khi POL trùng POD', async () => {
  const user = userEvent.setup();
  render(<BookingForm onSubmit={vi.fn()} />);
  await user.type(screen.getByLabelText('Cảng đi (POL)'), 'VNSGN');
  await user.type(screen.getByLabelText('Cảng đến (POD)'), 'VNSGN');
  await user.click(screen.getByRole('button', { name: 'Đặt chỗ' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('POL và POD phải khác nhau');
});
~~~

### E2E với Playwright và chuyện flaky test
Chỉ giữ vài luồng sống còn: đăng nhập → tạo booking → thấy trong danh sách; tra tracking theo số B/L. Playwright tự chờ phần tử sẵn sàng (auto-wait); [[trace: 'on-first-retry']] ghi DOM, network, console từng bước để mở bằng trace viewer khi CI đỏ. [[retries: 2]] trên CI giữ pipeline xanh nhưng **che flaky**: test "passed on retry" phải được theo dõi như một lỗi.
| Triệu chứng | Nguyên nhân hay gặp | Cách sửa |
|---|---|---|
| Lúc đỏ lúc xanh, đỏ nhiều hơn trên CI | [[waitForTimeout]] cố định, máy CI chậm hơn | web-first assertion [[expect(locator).toBeVisible()]] tự chờ đúng điều kiện |
| Chạy riêng xanh, chạy cả suite đỏ | dùng chung dữ liệu, phụ thuộc thứ tự test | mỗi test tự tạo dữ liệu qua API, tên duy nhất, không ghi chung một tài khoản |
| Đỏ vào giờ hoặc ngày nhất định | múi giờ, cuối tháng, ETA so với "bây giờ" | đóng băng đồng hồ ([[page.clock]]), timezone cố định trong config |
| Đỏ khi đối tác chậm | gọi API thật của bên thứ ba | chặn bằng [[page.route]] hoặc stub ở BFF trong môi trường test |
Quy trình: flaky → gắn nhãn, quarantine **có hạn** (ví dụ 1 tuần, có ticket và người chịu trách nhiệm), sửa gốc; không xoá âm thầm.

### Contract test (Pact): khi nào đáng làm
Consumer (Next.js) viết test sinh ra **pact**: "GET /bookings/BKG123 trả 200 với các field bookingNo, status, eta". Provider (NestJS BFF) verify pact đó trong CI của mình; Pact Broker + [[can-i-deploy]] chặn deploy phá hợp đồng. Đáng làm khi FE và BFF thuộc team khác, release độc lập, hoặc có đối tác tích hợp API. Nếu cùng monorepo, cùng deploy, chung type TS và schema zod thì type-check đã bắt phần lớn: đừng thêm Pact cho có.

### UAT và vai trò của dev
UAT (User Acceptance Testing) là business/PO/khách xác nhận tính năng **đúng nghiệp vụ** trên môi trường giống prod; nó không thay QA tìm bug kỹ thuật. Việc của dev:
- Cùng BA/PO viết acceptance criteria dạng **Given/When/Then** ngay lúc refinement, trước khi code.
- Dựng môi trường UAT giống prod (cùng image, khác cấu hình qua env runtime, dữ liệu ẩn danh) và **script seed idempotent**: booking ở mọi trạng thái, container đủ chuỗi sự kiện, tài khoản theo từng vai trò.
- Viết release note + checklist, trực hỗ trợ trong đợt UAT, phân loại phản hồi: bug, change request hay hiểu nhầm yêu cầu.
~~~
Given booking BKG001 có ETA 2026-10-21 08:00 tại SGSIN và khách đã bật thông báo email
When hệ thống nhận sự kiện ETA mới 2026-10-21 16:00
Then khách nhận đúng 1 email trong vòng 5 phút
And nhận lại cùng sự kiện đó lần nữa không tạo email thứ 2
~~~

### Regression tự động trong CI và quality gate
| Lúc chạy | Chạy gì | Thời gian mục tiêu | Vai trò |
|---|---|---|---|
| Mỗi PR | lint, type-check, unit, integration, build, smoke E2E 3–5 luồng | ≤ 10–15 phút | chặn merge |
| Merge vào main | toàn bộ integration, verify contract, deploy staging, smoke trên staging | ≤ 30 phút | chặn deploy |
| Nightly | full E2E regression nhiều trình duyệt, dependency audit, load test nhẹ | 1–2 giờ | báo cáo, tạo ticket |
| Trước release | regression đầy đủ + UAT sign-off | theo lịch release | gate phát hành |
- **Quality gate** (chính là "công cụ phân tích" trong JD): SonarQube/SonarCloud chặn PR theo *code mới*; gate mặc định "Sonar way" đòi coverage code mới ≥ 80%, trùng lặp ≤ 3%, không có issue mới, security hotspot đã review. Thêm [[npm audit]]/Dependabot cho dependency, CodeQL hoặc Semgrep cho SAST.
- **Mỗi bug fix kèm một test đỏ trước, xanh sau**, đặt tên theo mã ticket. Đây là cách chặn kiểu "fix bị merge đảo ngược".

### Coverage: đọc đúng ý nghĩa
Coverage chỉ nói dòng/nhánh nào **đã chạy**, không nói assertion có đúng: test gọi hàm mà không [[expect]] gì vẫn được tính. Dùng coverage để **tìm vùng chưa test** và gate trên code mới; đừng đặt KPI 90% toàn repo (người ta sẽ viết test rác để đạt). Muốn đo chất lượng assertion có mutation testing (Stryker): biết là có, dùng cho module lõi như tính cước.

### Dữ liệu test, idempotency và lỗi mạng
- **Factory/builder** thay vì JSON fixture khổng lồ: [[buildBooking({ status: 'DISCHARGED' })]] chỉ ghi field quan trọng với test, phần còn lại mặc định hợp lệ.
- **Idempotency**: consumer RabbitMQ/Pub/Sub nhận message lặp (at-least-once) → test "xử lý cùng message 2 lần, kết quả như 1 lần".
- **Lỗi mạng**: MSW/nock trả 500, timeout, body hỏng; Toxiproxy (có module Testcontainers) thêm latency, cắt kết nối. Test "broker restart thì publisher tự reconnect" bắt được sự cố RabbitMQ publisher singleton của bạn; test "một item lỗi không đầu độc cả batch" bắt được sự cố FetchBatch nuốt lỗi.

### Sai lầm hay gặp
- Mock mọi thứ nên test chỉ kiểm mock; hoặc ngược lại, mọi thứ là E2E nên suite chạy 1 giờ và không ai chờ.
- Assert implementation (hàm private được gọi 2 lần) thay vì hành vi → refactor là vỡ test.
- Sleep cố định trong E2E; dữ liệu dùng chung giữa các test; bật retry rồi quên theo dõi flaky.
- Coverage 90% làm KPI → test không có assertion.
- Chạy NestJS dưới Vitest mà không dùng plugin SWC → mất decorator metadata, DI báo provider undefined.
- Đẩy UAT cho business khi chưa có acceptance criteria và dữ liệu seed → UAT thành buổi khám phá yêu cầu.

### Nói thế nào trong phỏng vấn (EN)
- "I put each test at the cheapest level that can still catch that class of bug." — Đặt test ở tầng rẻ nhất mà vẫn bắt được loại bug đó.
- "Integration tests run against real Postgres and Redis in Testcontainers, because most of our production bugs lived in SQL and configuration, not in pure logic." — Integration chạy DB thật vì bug production nằm ở SQL và cấu hình.
- "A retry that turns a test green is a signal, not a fix; flaky tests get an owner and a deadline." — Retry xanh là tín hiệu, không phải bản sửa.
- "Every bug fix ships with a regression test named after the ticket, so a bad merge cannot silently revert it." — Mỗi fix kèm test mang mã ticket để merge sai không đảo ngược được.
- "Coverage tells me what is unexecuted, not what is verified, so we gate on new-code coverage." — Coverage chỉ cho biết chỗ chưa chạy, nên gate trên code mới.
`,
  apply: `
### Áp dụng: kể gì trong phỏng vấn OTS và luyện gì
- **Câu chuyện regression**: fix crash dịch trình duyệt bị một PR khác đảo ngược; giới hạn 7 ngày của audit export bị PR của ticket khác đổi lại. Hành động bạn đề xuất: regression test gắn mã ticket + audit diff khi merge nhánh release. Đây là câu trả lời mạnh cho "How do you ensure quality?".
- **Câu chuyện integration**: các sự cố production của bạn (statement_timeout ở cấp role, FDW schema stale, publish trước commit) đều không bắt được bằng unit test với mock. Đó là lý do bạn chọn Testcontainers, kể kèm sự cố cụ thể.
- **Chuyển từ Go**: table-driven test ↔ [[it.each]]; testcontainers-go ↔ testcontainers-node; [[httptest]] ↔ Supertest. Nói rõ "cùng tư duy, khác thư viện".
- **Bằng chứng hiện có**: dcn_toolbox đã có spec Vitest cho parser, crypto, deploy runner. Còn thiếu: integration HTTP + DB thật và E2E.
- **Luyện 1**: thêm Supertest + Testcontainers Postgres cho service auth (mật khẩu + TOTP; fake timers kiểm cửa sổ 30 s).
- **Luyện 2**: 1 Playwright smoke "đăng nhập → mở SSH Monitor" + GitHub Actions: PR chạy lint/type-check/unit/smoke, nightly chạy full.
- **Luyện 3**: viết 3 acceptance criteria Given/When/Then cho tính năng "báo khách khi ETA đổi", nối mỗi tiêu chí với một test tự động.
`,
  quiz: [
    { t: 'mc', q: 'Bug hay gặp nhất của một service NestJS là query SQL sai, thiếu constraint, migration lệch. Tầng test rẻ nhất bắt được loại bug này?', o: ['Unit test với repository được mock', 'Integration test với Postgres thật qua Testcontainers', 'E2E Playwright đi qua UI', 'Contract test bằng Pact'], a: 1, why: 'Mock repository không chạy SQL thật; E2E bắt được nhưng chậm và khó chỉ ra lỗi; Pact chỉ kiểm hợp đồng API.' },
    { t: 'mc', q: 'Một E2E Playwright đỏ khoảng 1/10 lần trên CI, chạy local luôn xanh; code có page.waitForTimeout(2000) trước khi kiểm bảng booking. Cách sửa đúng?', o: ['Tăng thời gian chờ lên 5000 ms', 'Bật retries: 3 và coi như xong', 'Xoá test khỏi suite cho CI xanh', 'Thay bằng web-first assertion như expect(locator).toBeVisible() để chờ đúng điều kiện'], a: 3, why: 'Sleep cố định là nguồn flaky kinh điển; assertion tự chờ theo điều kiện thật. Retry chỉ che triệu chứng.' },
    { t: 'mc', q: 'Trong React Testing Library, cách chọn phần tử nào được khuyến nghị nhất?', o: ['container.querySelector(".btn-primary")', 'getByTestId("submit")', 'getByRole("button", { name: "Đặt chỗ" })', 'Lấy phần tử con thứ 3 của form'], a: 2, why: 'Query theo role và tên truy cập giống cách người dùng nhìn thấy, sống qua refactor CSS và kiểm luôn accessibility.' },
    { t: 'mc', q: 'Coverage đạt 95% nhưng bug vẫn lọt nhiều. Giải thích hợp lý nhất?', o: ['Coverage đo dòng đã chạy, không đo assertion có kiểm đúng hành vi; cần xem chất lượng assertion và đặt test đúng tầng', 'Công cụ coverage tính sai số dòng', 'Phải lên 100% thì mới hết bug', 'Coverage chỉ có ý nghĩa với E2E'], a: 0, why: 'Coverage cho biết chỗ chưa chạy, không chứng minh đúng. Mutation testing đo chất lượng assertion.' },
    { t: 'mc', q: 'FE Next.js và NestJS BFF do 2 team release độc lập; FE hay vỡ vì BFF đổi tên field trong response. Biện pháp nhắm đúng vấn đề?', o: ['Thêm E2E cho mọi màn hình', 'Contract test (Pact) và can-i-deploy trong CI của BFF', 'Tăng coverage của BFF lên 90%', 'Thêm unit test cho FE với API được mock'], a: 1, why: 'Contract test bắt đúng việc provider phá hợp đồng với consumer, trước khi deploy; mock ở FE thì không bao giờ thấy BFF đổi.' },
    { t: 'fill', q: 'Điền: trong NestJS, thay dependency thật (ví dụ client EDI) bằng bản giả: Test.createTestingModule({ imports: [AppModule] }).___(EdiClient).useValue(fake).', a: ['overrideprovider', 'override provider'], why: 'overrideProvider giữ toàn bộ module thật, chỉ thay đúng biên cần fake.' },
    { t: 'fill', q: 'Điền: acceptance criteria cho UAT thường viết theo khuôn Given / When / ___.', a: ['then'], why: 'Given (bối cảnh) / When (hành động hoặc sự kiện) / Then (kết quả kiểm chứng được); có thể thêm And.' },
    { t: 'open', q: 'Interviewer: "How would you set up the test strategy and CI quality gates for a new booking service built with NestJS and Next.js?" (trả lời 3–5 câu)', a: 'I would put most tests at the **unit** level for pure business rules like ETA notifications and pricing, plus integration tests that run the NestJS app with Supertest against real Postgres and Redis in **Testcontainers**, overriding only external providers like the EDI client. On the frontend, React Testing Library with MSW covers forms and data states, and a small set of **Playwright** E2E tests covers the critical booking and tracking flows. Every PR runs lint, type-check, unit, integration and an E2E smoke; the full **regression** suite runs nightly, and every bug fix adds a test named after its ticket. The **quality gate** in SonarQube blocks merges on new-code coverage and new issues, and flaky tests get an owner and a deadline instead of silent retries.', keys: ['unit', 'Testcontainers', 'Playwright', 'regression', 'quality gate'] }
  ]
},
];
