// prom-see: PromptCom の複数枚作品を「次」ボタンひとつで送る。
// その上に「前」、ビューアでは下に「閉じる」も出す。キーは B が「前」、N が「次」、M が「閉じる」。
//
// サイトは 3 通りの見せ方をしている（2026-09 実測）。
//   ビューア (/p/<id>/viewer) : 全画面の Swiper（右→左、loop なし、最後に「いかがでしたか」カード）
//   ファイル (/p/<id>)        : 本文カラム内の Swiper（loop あり）。下のスライダーは Swiper に追従する
//   イラスト (/p/<id>)        : サムネイルと「作品を見る (N枚)」リンク。ビューアを別タブで開く
// Swiper のインスタンスは要素の .swiper プロパティにあり、ページ側の JS 世界からしか見えないため、
// この script は manifest で world: "MAIN" として注入している。
// ビューア右上の ✕ は、詳細ページから開いたタブなら閉じ、直接開いたときは詳細ページへ戻る。
// 「閉じる」はこの ✕ をそのまま押すことで同じ動作にしている。

(() => {
  const MARGIN = 16;
  const WIDTH = 76;

  const host = document.createElement("div");
  host.id = "prom-see-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      button {
        position: fixed;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2147483000;
        width: ${WIDTH}px;
        height: 64px;
        padding: 0;
        border: none;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
        background: rgba(73, 11, 184, 0.85);
        color: #fff;
        font: 20px/1 system-ui, sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        cursor: pointer;
        user-select: none;
      }
      button:hover { background: rgba(73, 11, 184, 1); }
      button:active { transform: translateY(-50%) scale(0.94); }
      button[hidden] { display: none; }
      .label { font-weight: bold; }
      .small .label { font-size: 16px; }
      .page { font-size: 11px; opacity: 0.85; font-variant-numeric: tabular-nums; }
      .prev, .close {
        transform: none;
        height: 36px;
        font-size: 15px;
        font-weight: bold;
      }
      .prev { top: calc(50% - 76px); }
      .prev:active { transform: scale(0.94); }
      .close {
        top: calc(50% + 40px);
        background: rgba(40, 40, 40, 0.85);
      }
      .close:hover { background: rgba(40, 40, 40, 1); }
      .close:active { transform: scale(0.94); }
    </style>
    <button type="button" class="prev" title="前 (B)" hidden>前</button>
    <button type="button" class="next" title="次 (N)" hidden>
      <span class="label">次</span><span class="page"></span>
    </button>
    <button type="button" class="close" title="閉じる (M)" hidden>閉じる</button>
  `;
  const button = root.querySelector(".next");
  const prevButton = root.querySelector(".prev");
  const closeButton = root.querySelector(".close");
  const labelEl = root.querySelector(".label");
  const pageEl = root.querySelector(".page");

  // 現在のページで「次」が何をするかを調べる。何もできなければ null。
  function detect() {
    const viewer = document.querySelector(".fixed.inset-0 .swiper");
    if (viewer && viewer.swiper) {
      return { kind: "swiper", swiper: viewer.swiper, right: window.innerWidth };
    }

    const slide = document.querySelector(".bg-bgSlide");
    if (!slide) return null;
    // サイドバーを除いた本文カラムの右端
    const column = slide.parentElement || slide;
    const right = column.getBoundingClientRect().right;

    const inline = slide.querySelector(".swiper");
    if (inline && inline.swiper) {
      return { kind: "swiper", swiper: inline.swiper, right };
    }

    const link = slide.querySelector('a[href$="/viewer"]');
    if (link) {
      const m = link.textContent.match(/(\d+)\s*枚/);
      const total = m ? Number(m[1]) : 0;
      if (total > 1) return { kind: "open", link, right, total };
    }
    return null;
  }

  // 画像が多い作品のビューアは Virtual Slides で、DOM には表示中の近くの 2〜3 枚しかない。
  // 全体は swiper.virtual.slides（React 要素の配列）にある（2026-09 実測、11 枚・15 枚の作品）
  function virtualSlides(swiper) {
    return swiper.params.virtual?.enabled ? swiper.virtual?.slides : null;
  }

  function realCount(swiper) {
    const v = virtualSlides(swiper);
    if (v) return v.length;
    return [...swiper.slides].filter(
      (s) => !s.classList.contains("swiper-slide-duplicate")
    ).length;
  }

  function atLast(swiper) {
    if (swiper.params.loop) return swiper.realIndex >= realCount(swiper) - 1;
    return swiper.isEnd;
  }

  function atFirst(swiper) {
    return (swiper.params.loop ? swiper.realIndex : swiper.activeIndex) === 0;
  }

  // 何枚目 / 全何枚。ビューアの最後の「いかがでしたか」カードは枚数に数えず、
  // そこでは最後の 1 枚と同じ表示にする
  function pageInfo(c) {
    if (c.kind === "open") return [1, c.total];
    const s = c.swiper;
    if (s.params.loop) return [s.realIndex + 1, realCount(s)];
    // カードは Virtual では key が ".$cross-promo"、そうでなければ先頭の子に
    // overflow-hidden が付かないことで見分ける（画像スライドには付く。2026-09 実測）
    const v = virtualSlides(s);
    const total =
      (v
        ? v.filter((e) => !String(e?.key).includes("cross-promo")).length
        : [...s.slides].filter((x) =>
            x.firstElementChild?.classList.contains("overflow-hidden")
          ).length) || realCount(s);
    return [Math.min(s.activeIndex + 1, total), total];
  }

  // ビューア右上の ✕（アイコンの形で見分ける）
  function findSiteClose() {
    return document.querySelector(
      '.fixed.inset-0 button:has(path[d="M6 18 18 6M6 6l12 12"])'
    );
  }

  let current = null;
  let siteClose = null;

  function update() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    siteClose = findSiteClose();
    closeButton.hidden = !siteClose;
    closeButton.style.left = `${Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN)}px`;
    current = detect();
    if (
      !current ||
      current.swiper?.destroyed ||
      current.right <= 0 ||
      (current.kind === "swiper" && realCount(current.swiper) < 2)
    ) {
      button.hidden = prevButton.hidden = true;
      return;
    }
    const label =
      current.kind === "open" ? "見る" : atLast(current.swiper) ? "最初" : "次";
    if (labelEl.textContent !== label) {
      labelEl.textContent = label;
      button.title = `${label} (N)`;
    }
    button.classList.toggle("small", label.length > 1);
    const [cur, total] = pageInfo(current);
    const page = `${cur} / ${total}`;
    if (pageEl.textContent !== page) pageEl.textContent = page;
    const left = Math.max(MARGIN, current.right - WIDTH - MARGIN);
    button.style.left = `${left}px`;
    button.hidden = false;

    // 「前」は Swiper のあるページだけ（「見る」の段階では戻る先がない）
    if (current.kind === "swiper") {
      const prevLabel = atFirst(current.swiper) ? "最後" : "前";
      if (prevButton.textContent !== prevLabel) {
        prevButton.textContent = prevLabel;
        prevButton.title = `${prevLabel} (B)`;
      }
      prevButton.style.left = `${left}px`;
      prevButton.hidden = false;
    } else {
      prevButton.hidden = true;
    }
  }

  // ボタンが見えているときだけ、その表示どおりの動作をする
  function press() {
    update();
    const c = current;
    if (!c || button.hidden) return false;
    if (c.kind === "open") {
      c.link.click();
    } else if (atLast(c.swiper)) {
      if (c.swiper.params.loop) c.swiper.slideToLoop(0);
      else c.swiper.slideTo(0);
    } else {
      c.swiper.slideNext();
    }
    setTimeout(update, 50);
    return true;
  }

  // 1 枚目では最後の画像へ（ビューアの「いかがでしたか」カードではなく、最後の画像）
  function pressPrev() {
    update();
    const c = current;
    if (!c || prevButton.hidden) return false;
    if (!atFirst(c.swiper)) {
      c.swiper.slidePrev();
    } else if (c.swiper.params.loop) {
      c.swiper.slideToLoop(realCount(c.swiper) - 1);
    } else {
      c.swiper.slideTo(pageInfo(c)[1] - 1);
    }
    setTimeout(update, 50);
    return true;
  }

  function pressClose() {
    update();
    if (closeButton.hidden) return false;
    siteClose.click();
    return true;
  }

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    press();
  });

  prevButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pressPrev();
  });

  closeButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pressClose();
  });

  // B / N / M キーでも押せる。入力欄での文字入力や修飾キー付きの操作は邪魔しない
  function isTyping(el) {
    for (; el; el = el.parentElement || el.getRootNode().host) {
      if (el.isContentEditable) return true;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== "range") {
        return true;
      }
    }
    return false;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      const action = { KeyB: pressPrev, KeyN: press, KeyM: pressClose }[e.code];
      if (!action || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.repeat || e.isComposing || isTyping(e.target)) return;
      if (action()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // Next.js の画面遷移や Swiper の遅延初期化に追従するため、定期的に見直す
  setInterval(update, 300);
  window.addEventListener("resize", update);
  update();
})();
