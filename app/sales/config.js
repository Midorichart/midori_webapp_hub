// 수익 통계 페이지 설정
// Supabase 는 TaskManager 와 같은 프로젝트를 씁니다 (Publishable key 는 공개돼도 되는 키).
// 주문 데이터는 로그인 + RLS 로 보호되어, 본인 계정으로 로그인해야만 보입니다.
window.SALES_CONFIG = {
  SUPABASE_URL: 'https://avnqsbwbmvwtpkquvrtt.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_GTRIqmu5GN5yeYswVZNb2g_9QcR32M4',
  // 로컬 미리보기 전용: 주문 JSON 파일 경로를 넣으면 Supabase 대신 그 파일을 읽습니다.
  // 실제 매출 데이터라 저장소에 올리면 안 되니, 배포할 때는 꼭 비워 두세요.
  ORDERS_JSON: '',
};
