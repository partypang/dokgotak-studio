import ApiKeyPopup from "./api-key-popup";
import UploadPanel from "./upload-panel";
import VideoMergePanel from "./video-merge-panel";

const deliverables = [
  {
    label: "사진 한 장",
    title: "제품의 핵심을 읽습니다",
    body: "상세페이지 이미지나 제품 사진에서 구매 포인트와 화면 구성을 뽑아냅니다.",
  },
  {
    label: "쇼츠 기획",
    title: "릴스와 쇼츠 흐름으로 바꿉니다",
    body: "인스타 릴스, 유튜브 쇼츠, 틱톡 쇼츠에 맞는 대본과 자막 문장을 정리합니다.",
  },
  {
    label: "영상 제작",
    title: "짧은 광고 영상으로 완성합니다",
    body: "이미지 지시서, 나레이션, 자막, 영상 이어붙이기까지 제작 흐름을 연결합니다.",
  },
];

export default function Home() {
  return (
    <main className="bg-[#f6f3ec] text-[#161616]">
      <header className="sticky top-0 z-50 border-b border-[#ded7cb] bg-[#fffdf8]/96 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 sm:px-8 md:flex-row md:items-center md:justify-between">
          <a
            href="#video-merge"
            className="flex items-center gap-4 text-[#111111] transition hover:text-[#e74032]"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[#ffcf3f] text-[2.7rem] font-black leading-none text-[#111111]">
              D
            </span>
            <span className="text-2xl font-black leading-none sm:text-3xl">
              DOKGOTAK STUDIO
            </span>
          </a>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <a
              href="#video-merge"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#ded7cb] bg-white px-4 text-sm font-black text-[#2b2925] transition hover:border-[#e74032] hover:text-[#e74032]"
            >
              영상 이어붙이기
            </a>
            <a
              href="#upload"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#ded7cb] bg-white px-4 text-sm font-black text-[#2b2925] transition hover:border-[#e74032] hover:text-[#e74032]"
            >
              파일 넣기
            </a>
            <ApiKeyPopup variant="inline" />
          </div>
        </div>
      </header>

      <section id="outputs" className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-bold text-[#e74032]">
            DOKGOTAK PHILOSOPHY
          </p>
          <h2 className="mt-3 whitespace-nowrap text-[clamp(1.55rem,4.2vw,3rem)] font-black leading-tight">
            독고탁 스튜디오는 사진 한 장이면 충분합니다.
          </h2>
          <p className="mt-5 max-w-4xl break-keep text-lg font-semibold leading-8 text-[#4a453c]">
            인스타 릴스, 유튜브 쇼츠, 틱톡 쇼츠까지 바로 쓸 수 있는 짧은
            영상 제작을 목표로 합니다.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {deliverables.map((item) => (
            <article
              key={item.label}
              className="rounded-lg border border-[#ded7cb] bg-white p-6 shadow-[0_18px_50px_rgba(24,24,24,0.07)]"
            >
              <p className="text-sm font-bold text-[#007f8a]">{item.label}</p>
              <h3 className="mt-4 text-2xl font-black leading-tight">
                {item.title}
              </h3>
              <p className="mt-4 leading-7 text-[#5c574f]">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="video-merge" className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <VideoMergePanel />
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <UploadPanel />
      </section>

    </main>
  );
}
