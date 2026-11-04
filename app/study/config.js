// 학습 대시보드 Supabase 연결 설정
// Task Manager 와 같은 프로젝트를 씁니다 (Publishable key 는 공개돼도 되는 키).
// 데이터는 로그인 + RLS 로 보호되어 본인 계정으로 로그인해야만 보입니다.
// 비워 두면 예전처럼 브라우저 localStorage 에만 저장하는 로컬 모드로 동작합니다.
window.STUDY_CONFIG = {
  SUPABASE_URL: 'https://avnqsbwbmvwtpkquvrtt.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_GTRIqmu5GN5yeYswVZNb2g_9QcR32M4',
};
