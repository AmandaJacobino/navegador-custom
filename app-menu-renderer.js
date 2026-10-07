const menuMemory = document.getElementById('menu-memory');

window.appMenuAPI.onShow(() => {
  document.body.classList.remove('entering');
  void document.body.offsetWidth;
  document.body.classList.add('entering');
});

menuMemory.addEventListener('click', () => {
  window.appMenuAPI.close();
  window.appMenuAPI.openMemory();
});
