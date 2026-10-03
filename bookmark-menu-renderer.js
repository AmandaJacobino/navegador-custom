const menuAddBookmark = document.getElementById('menu-add-bookmark');
const menuRemoveBookmark = document.getElementById('menu-remove-bookmark');
const menuToggleSpeedDial = document.getElementById('menu-toggle-speed-dial');
const menuManageBookmarks = document.getElementById('menu-manage-bookmarks');

window.bookmarkMenuAPI.onShow((state) => {
  menuAddBookmark.disabled = !!state?.bookmarked;
  menuRemoveBookmark.disabled = !state?.bookmarked;
  menuToggleSpeedDial.setAttribute('aria-pressed', String(!!state?.speedDial));
  // Reinicia a animação mesmo com o documento reaproveitado entre aberturas.
  document.body.classList.remove('entering');
  void document.body.offsetWidth;
  document.body.classList.add('entering');
});

// bookmarks:toggleCurrent já decide add-ou-remove pelo estado atual da aba —
// como cada botão só fica habilitado no caso certo, os dois podem chamar a
// mesma ação. O menu nativo original fechava a cada clique, independente do
// item — mantido aqui pra não mudar o comportamento que já existia.
menuAddBookmark.addEventListener('click', async () => {
  await window.bookmarkMenuAPI.toggleBookmark();
  window.bookmarkMenuAPI.close();
});
menuRemoveBookmark.addEventListener('click', async () => {
  await window.bookmarkMenuAPI.toggleBookmark();
  window.bookmarkMenuAPI.close();
});
menuToggleSpeedDial.addEventListener('click', async () => {
  await window.bookmarkMenuAPI.toggleSpeedDial();
  window.bookmarkMenuAPI.close();
});
menuManageBookmarks.addEventListener('click', () => {
  window.bookmarkMenuAPI.openManage();
  window.bookmarkMenuAPI.close();
});
