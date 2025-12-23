import { createClient } from "../lib/server";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useNavigation,
  Form,
} from "react-router";

/* ============== loader: DB 읽기만 ============== */
export async function loader({ request }) {
  const { supabase } = createClient(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sort = url.searchParams.get("sort") || "latest";

  const base = supabase
    .from("group")
    .select("id, title, description, writer, created_at");

  let data, error;
  if (!q || q.length < 2) {
    ({ data, error } = await base.order("created_at", {
      ascending: false,
      nullsFirst: false,
    }));
  } else {
    ({ data, error } = await base
      .or(`title.ilike.%${q}%,description.ilike.%${q}%,writer.ilike.%${q}%`)
      .order("created_at", { ascending: false, nullsFirst: false }));
  }
  if (error) throw new Response(error.message, { status: 500 });

  // created_at → 안전한 number 타임스탬프(_ts)
  const toTs = (s) => {
    if (!s) return NaN;

    // 1) 타임존 표시가 있으면 기본 파서 사용 (Z, +09:00, +0900, +09 등)
    if (/(Z|[+-]\d{2}:\d{2}|[+-]\d{4}|[+-]\d{2})$/.test(s)) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }

    // 2) naive: "YYYY-MM-DD HH:mm:ss" 또는 "YYYY-MM-DDTHH:mm:ss" → 로컬 시각으로 해석
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/,
    );
    if (m) {
      const [, Y, M, D, h, mi, se] = m;
      const d = new Date(+Y, +M - 1, +D, +h, +mi, +se, 0); // 로컬 타임존
      const t = d.getTime();
      return Number.isFinite(t) ? t : NaN;
    }

    // 3) 마지막 시도
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  };

  const rows = (data || []).map((r) => {
    const ts = toTs(r?.created_at);
    return {
      ...r,
      _ts: Number.isFinite(ts) ? ts : -Infinity, // 정렬/표시에 안전
    };
  });

  return { q, sort, rows };
}

/* (선택) 쿼리 바뀔 때만 재검증 */
export function shouldRevalidate({ currentUrl, nextUrl }) {
  return (
    currentUrl.searchParams.get("q") !== nextUrl.searchParams.get("q") ||
    currentUrl.searchParams.get("sort") !== nextUrl.searchParams.get("sort")
  );
}

/* ============== 유틸 ============== */

// _ts(number) 기반 상대/절대 시간 계산
function formatRelativeOrDateFromTs(ts) {
  if (!Number.isFinite(ts)) return "";

  let diffMs = Date.now() - ts;
  if (diffMs < 0) diffMs = 0; // 와 이거 킥이다 그냥 미래시간이면 0으로 처리하는 것 떄문에 몇시간을 고생했냐 슈발

  const min = Math.floor(diffMs / 60000);
  const hr = Math.floor(diffMs / 3600000);

  if (hr < 24) {
    if (min < 1) return "방금 전"; // 1분 미만
    if (hr < 1) return `${min}분 전`; // 1시간 미만
    return `${hr}시간 전`; // 24시간 미만
  }

  const d = new Date(ts);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

// 원본 가중치/로직 유지
function relevanceScore(item, q) {
  const needle = (q || "").toLowerCase();
  const t = String(item.title || "").toLowerCase();
  const d = String(item.description || "").toLowerCase();
  const w = String(item.writer || "").toLowerCase();
  const posScore = (s) =>
    s.indexOf(needle) < 0 ? 0 : 100 - Math.min(s.indexOf(needle), 99);
  const freq = (s) =>
    (
      s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ||
      []
    ).length;
  return (
    3 * (posScore(t) + 10 * freq(t)) +
    2 * (posScore(d) + 5 * freq(d)) +
    1 * (posScore(w) + 5 * freq(w))
  );
}

/* ============== 프레젠테이션 컴포넌트 ============== */

// ❶ 검색바
function SearchBar({ query, setQuery, sortMode, onSubmit }) {
  return (
    <div className="flex items-center p-4">
      <div className="w-[25px] h-[25px] text-black mr-3 shrink-0">
        <svg
          width="25"
          height="25"
          viewBox="0 0 25 25"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M16.0156 5.46875L8.98438 12.5L16.0156 19.5312"
            stroke="black"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <Form
        method="get"
        onSubmit={onSubmit}
        className="flex-1 rounded-full px-4 py-2 flex items-center gap-2"
        style={{ backgroundColor: "#ECECEC" }}
      >
        <div className="w-4 h-4 text-gray-500 shrink-0">
          <svg
            width="14"
            height="14"
            viewBox="0 0 25 25"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M10.7954 3.125C9.27835 3.125 7.79535 3.57486 6.53396 4.4177C5.27257 5.26053 4.28943 6.45849 3.70888 7.86007C3.12832 9.26166 2.97642 10.8039 3.27239 12.2918C3.56835 13.7797 4.29889 15.1465 5.37161 16.2192C6.44434 17.2919 7.81108 18.0225 9.29899 18.3184C10.7869 18.6144 12.3292 18.4625 13.7308 17.8819C15.1323 17.3014 16.3303 16.3183 17.1731 15.0569C18.016 13.7955 18.4658 12.3125 18.4658 10.7954C18.4657 8.76113 17.6575 6.81021 16.2191 5.37175C14.7806 3.9333 12.8297 3.12513 10.7954 3.125Z"
              stroke="black"
              strokeWidth="2"
              strokeMiterlimit="10"
            />
            <path
              d="M16.5181 16.5181L21.875 21.875"
              stroke="black"
              strokeWidth="2"
              strokeMiterlimit="10"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <input
          type="text"
          name="q"
          placeholder="행정위원회에서 검색하기"
          className="flex-1 w-0 min-w-0 bg-transparent outline-none text-gray-600 placeholder-gray-500 text-[14px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />

        <input type="hidden" name="sort" value={sortMode} />

        <button
          type="submit"
          className="text-sm font-medium text-gray-600 shrink-0"
        >
          검색
        </button>
      </Form>
    </div>
  );
}

// ❷ 최근검색 (비어있을 때 자체적으로 안내 문구 표시)
function RecentMessage({ items, onSelect }) {
  if (!items?.length) {
    return (
      <div className="flex-1 px-6 py-6">
        <h2 className="font-semibold text-black mb-6 text-[16px]">
          최근 검색어
        </h2>
        <div className="font-normal text-center text-gray-500 mt-20 text-[14px]">
          최근 검색어가 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 px-6 py-6">
      <h2 className="font-semibold text-black mb-6 text-[16px]">최근 검색어</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((q, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect?.(q)}
              className="px-3 py-1 rounded-full bg-white text-[13px] text-gray-700 border border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition"
              aria-label={`최근 검색어 ${q}로 검색`}
              title={`${q}로 검색`}
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ❸ 결과 카드
function ResultCard({ item, displayTime, isExpanded }) {
  return (
    <li className="bg-white border border-gray-200 rounded p-3">
      <div className="grid grid-cols-[1fr_auto] gap-x-2">
        <div className="col-[1/2] min-w-0">
          <div className="text-sm font-medium text-gray-900 break-words">
            {item.title ?? "제목 없음"}
          </div>
        </div>

        <div className="col-[2/3] text-xs text-black whitespace-nowrap ml-2 self-start">
          {displayTime}
        </div>

        <div className="col-[1/-1] mt-1 min-w-0">
          <div
            className={`text-xs text-gray-600 break-words ${
              isExpanded ? "" : "clamp-5"
            }`}
          >
            {item.description ?? "설명 없음"}
          </div>
        </div>

        {item.writer && (
          <div className="col-[1/-1] mt-2 text-[11px] text-gray-400 break-words">
            작성자: {item.writer}
          </div>
        )}
      </div>
    </li>
  );
}

// ❹ 스크롤업 버튼
function ScrollTopButton({ visible, onClick }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="맨 위로 이동"
      className="
        fixed left-1/2 -translate-x-1/2 bottom-6
        z-40 rounded-full
        bg-white/90 backdrop-blur
        shadow-lg border border-gray-200
        w-11 h-11 flex items-center justify-center
        active:scale-95 transition
      "
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M6 15l6-6 6 6"
          fill="none"
          stroke="black"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/* ============== 컨테이너(상태/라우팅) ============== */
export default function Search() {
  const { q: initialQ, sort: initialSort, rows } = useLoaderData();

  // 화면 상태
  const [query, setQuery] = useState(initialQ || "");
  const [sortMode, setSortMode] = useState(initialSort || "latest");
  const [recent, setRecent] = useState([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [expandedSet, setExpandedSet] = useState(() => new Set());

  // 라우팅/로딩
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  // 디바운스 ref
  const debounceRef = useRef(null);

  // 스크롤 위치 감지
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      setShowScrollTop(y > 400);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 맨 위로 스크롤
  const scrollToTop = () => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
  };

  // 최근 검색어 로드/저장(안정)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("recentSearches")) || [];
      setRecent(Array.isArray(saved) ? saved : []);
    } catch {
      setRecent([]);
    }
  }, []);

  // 검색어 바뀌면 카드 접기 초기화
  useEffect(() => {
    setExpandedSet(new Set());
  }, [initialQ]);

  // 결과 정렬: 최신/관련도
  const results = useMemo(() => {
    if (!rows?.length) return [];
    if (sortMode === "latest") return [...rows].sort((a, b) => b._ts - a._ts);
    return [...rows].sort(
      (a, b) => relevanceScore(b, query) - relevanceScore(a, query),
    );
  }, [rows, sortMode, query]);

  // 입력 변화 → 300ms 디바운스하여 URL 갱신(GET)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = (query || "").trim();
      const nextQ = trimmed.length >= 2 ? trimmed : "";
      const params = new URLSearchParams();
      if (nextQ) params.set("q", nextQ);
      if (sortMode) params.set("sort", sortMode);
      if (params.toString() !== searchParams.toString()) {
        navigate(`?${params.toString()}`, { replace: true });
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, sortMode]);

  // 폼 제출(엔터/버튼) — 최근검색 저장
  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = (query || "").trim();

    const params = new URLSearchParams();
    if (trimmed.length >= 2) params.set("q", trimmed);
    if (sortMode) params.set("sort", sortMode);

    if (params.toString() !== searchParams.toString()) {
      navigate(`?${params.toString()}`);
    }

    if (trimmed) {
      const next = [trimmed, ...recent.filter((x) => x !== trimmed)].slice(
        0,
        7,
      );
      setRecent(next);
      try {
        localStorage.setItem("recentSearches", JSON.stringify(next));
      } catch (error) {
        // localStorage 저장 실패 시 무시 (검색 기능은 정상 작동)
        console.error("최근 검색어 저장 실패:", error);
      }
    }
  };

  // 최근검색 선택
  const handleSelectRecent = (word) => {
    const trimmed = (word || "").trim();
    if (!trimmed) return;

    setQuery(trimmed);
    setExpandedSet(new Set());

    const params = new URLSearchParams();
    params.set("q", trimmed);
    params.set("sort", sortMode);
    navigate(`?${params.toString()}`);

    const next = [trimmed, ...recent.filter((x) => x !== trimmed)].slice(0, 7);
    setRecent(next);
    try {
      localStorage.setItem("recentSearches", JSON.stringify(next));
    } catch (error) {
      console.error("최근 검색어 저장 실패:", error);
    }
  };

  // 정렬 변경
  const onChangeSort = (value) => {
    setSortMode(value);
    const trimmed = (query || "").trim();
    const params = new URLSearchParams();
    if (trimmed.length >= 2) params.set("q", trimmed);
    params.set("sort", value);
    if (params.toString() !== searchParams.toString()) {
      navigate(`?${params.toString()}`, { replace: true });
    }
  };

  // 카드 펼침 토글 (id 없을 때도 안정적으로 동작)
  const toggleExpand = (key) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      className="max-w-sm mx-auto min-h-screen select-none"
      style={{ backgroundColor: "#F8F8FA" }}
    >
      {/* Search Header */}
      <SearchBar
        query={query}
        setQuery={setQuery}
        sortMode={sortMode}
        onSubmit={handleSubmit}
      />

      {/* 최근 검색어 */}
      <RecentMessage items={recent} onSelect={handleSelectRecent} />

      {/* 검색 결과 */}
      <div className="px-6 pb-16">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-black text-[16px]">검색 결과</h2>
          <select
            value={sortMode}
            onChange={(e) => onChangeSort(e.target.value)}
            className="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-black"
            title="정렬 기준"
          >
            <option value="latest">최신순</option>
            <option value="relevance">관련도순</option>
          </select>
        </div>

        {isLoading ? (
          <div className="text-sm text-gray-500">불러오는 중…</div>
        ) : !results.length ? (
          <div className="text-sm text-gray-500">검색 결과가 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {results.map((item, idx) => {
              // key/토글 키를 동일 기준으로 사용 (id 없을 때도 안정)
              const rowKey = item.id ?? item._ts ?? idx;
              return (
                <ResultCard
                  key={rowKey}
                  item={item}
                  displayTime={formatRelativeOrDateFromTs(item._ts)}
                  isExpanded={expandedSet.has(rowKey)}
                  onToggle={() => toggleExpand(rowKey)}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* 하단 중앙 스크롤업 버튼 */}
      <ScrollTopButton visible={showScrollTop} onClick={scrollToTop} />
    </div>
  );
}
