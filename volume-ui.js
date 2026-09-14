// Volume screening augments the existing single-symbol paper trader.
const volumeLabel = document.createElement('label');
volumeLabel.textContent = '매수 대상 · 당일 거래량 상위 N종목';
volumeLabel.htmlFor = 'volumeTop';
const volumeInput = document.createElement('input');
volumeInput.id = 'volumeTop'; volumeInput.type = 'number'; volumeInput.min = '1'; volumeInput.max = '50'; volumeInput.value = '20'; volumeInput.required = true;
const volumeHelp = document.createElement('small');
volumeHelp.textContent = '키움 시세 모드에 적용 · 거래된 주식 수 기준 · KRX · 관리종목 제외';
$('symbol').after(volumeLabel, volumeInput, volumeHelp);
const volumePanel = document.createElement('section');
volumePanel.className = 'panel';
volumePanel.innerHTML = '<h2>거래량 상위 종목</h2><p id="volumeStatus" class="muted"></p><small>선택한 한 종목을 거래합니다. 아래 종목 선택 후 정지 상태에서 설정을 적용하세요. 상위권 진입만으로 매수하지 않으며, 이동평균 교차가 함께 필요합니다.</small><div class="tablewrap"><table><thead><tr><th>순위 / 종목</th><th>당일 거래량</th><th>선택</th></tr></thead><tbody id="volumeRows"></tbody></table></div>';
$('chart').closest('section').after(volumePanel);
const baseRender = render;
const logoutButton = document.createElement('button');
logoutButton.textContent = '로그아웃'; logoutButton.className = 'secondary'; logoutButton.hidden = true;
logoutButton.onclick = async () => { try { await api('logout', {}); location.replace('/'); } catch (e) { $('error').textContent = e.message; } };
document.querySelector('header').append(logoutButton);
const hostingNotice = document.createElement('p'); hostingNotice.className = 'notice'; hostingNotice.hidden = true;
hostingNotice.textContent = '웹 모의매매 · 서버가 중지되면 매매도 멈춥니다. 재시작하면 계좌가 초기화되며, 무료 호스팅의 파일 기록은 사라질 수 있습니다. 종료 전에 CSV를 저장하세요.';
document.querySelector('header').after(hostingNotice);
render = function(s) {
  baseRender(s);
  logoutButton.hidden = !s.authEnabled; hostingNotice.hidden = !s.hosted;
  const f = s.volumeFilter;
  if (!f) return;
  $('volumeStatus').textContent = !f.active ? '가상 시세 모드: 거래량 필터 미적용. 키움 시세로 전환하면 상위 종목을 조회합니다.'
    : !f.updatedAt ? '순위 데이터 대기 · 신규 매수 차단'
    : `상위 ${f.top}종목 기준 · ${f.eligible ? '선택 종목: 매수 대상' : '선택 종목: 순위 밖, 신규 매수 차단'} · 조회 ${new Date(f.updatedAt).toLocaleTimeString('ko-KR')}`;
  $('volumeRows').replaceChildren();
  for (const item of f.leaders) {
    const row = $('volumeRows').insertRow();
    row.insertCell().textContent = `${item.rank}. ${item.name} (${item.symbol})`;
    row.insertCell().textContent = item.volume.toLocaleString('ko-KR') + '주';
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = '종목 선택'; button.disabled = s.running;
    button.onclick = () => { $('symbol').value = item.symbol; $('source').value = 'kiwoom'; $('symbol').focus(); };
    row.insertCell().append(button);
  }
};
$('config').onsubmit = e => {
  e.preventDefault();
  action('reset', { ...config(), source: $('source').value, symbol: $('symbol').value, volumeTop: Number($('volumeTop').value) });
};
const backtestNote = document.createElement('p'); backtestNote.className = 'muted';
backtestNote.textContent = '이 CSV 백테스트에는 과거 전체시장 거래량 순위가 없어 거래량 필터를 적용하지 않습니다.';
$('testResult').after(backtestNote);
