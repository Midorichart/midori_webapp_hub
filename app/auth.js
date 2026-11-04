// /app/ 아래 툴은 로그인해야만 열린다.
// 각 툴의 <head> 맨 앞에서 불러오면, 이 브라우저에 로그인 정보가 없을 때 화면을 그리기 전에 /app/ 로그인 화면으로 보낸다.
// 로그인 정보가 있어도 만료됐으면 각 툴이 세션을 확인한 뒤 midoriToLogin() 으로 보낸다.
// (데이터 자체는 Supabase 로그인 + RLS 로 보호된다. 이 파일은 화면을 막는 역할)
(function () {
  // supabase-js 가 로그인 정보를 저장하는 localStorage 키: sb-<프로젝트 ref>-auth-token
  var KEY = 'sb-avnqsbwbmvwtpkquvrtt-auth-token';
  var LOGIN = '/app/';

  window.midoriToLogin = function () {
    var next = location.pathname + location.search + location.hash;
    location.replace(LOGIN + '?next=' + encodeURIComponent(next));
  };

  var hasSession = false;
  try { hasSession = !!localStorage.getItem(KEY); } catch (e) {}
  if (!hasSession) {
    document.documentElement.style.display = 'none';
    window.midoriToLogin();
  }
})();
