(() => {
  'use strict';

  // 与后端图片级状态机对应的中文徽标文案
  const STATUS_LABELS = {
    UPLOADED: '已上传',
    VALIDATING: '校验中',
    READY: '待生成',
    GENERATING: '生成中',
    SUCCEEDED: '已完成',
    FAILED: '失败',
    REJECTED: '非物理题',
  };
  const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'REJECTED']);
  const POLL_INTERVAL_MS = 2500;
  const MAX_POLL_ERRORS = 5;

  const els = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    uploadBtn: document.getElementById('upload-btn'),
    selectedSummary: document.getElementById('selected-summary'),
    pageStatus: document.getElementById('page-status'),
    batchSection: document.getElementById('batch-section'),
    batchTitle: document.getElementById('batch-title'),
    cards: document.getElementById('cards'),
    modal: document.getElementById('modal'),
    modalMessage: document.getElementById('modal-message'),
    modalClose: document.getElementById('modal-close'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxDownload: document.getElementById('lightbox-download'),
    lightboxClose: document.getElementById('lightbox-close'),
  };

  let selectedFiles = [];
  let batchId = null;
  let pollTimer = null;
  let pollErrorCount = 0;
  let uploadInFlight = false;
  const rejectionModalShown = new Set();
  // 模态/灯箱打开时的焦点位置，关闭时归还（配合可达性焦点管理）
  let modalReturnFocus = null;
  let lightboxReturnFocus = null;
  let lightboxReturnImageId = null;

  function showPageStatus(message) {
    els.pageStatus.textContent = message;
    els.pageStatus.hidden = false;
  }

  function clearPageStatus() {
    els.pageStatus.hidden = true;
    els.pageStatus.textContent = '';
  }

  // ---- 上传 ----

  function updateSelectedSummary() {
    if (selectedFiles.length === 0) {
      els.selectedSummary.hidden = true;
      els.uploadBtn.disabled = true;
      return;
    }
    const names = selectedFiles.map((f) => f.name).join('、');
    els.selectedSummary.textContent = `已选择 ${selectedFiles.length} 张图片：${names}`;
    els.selectedSummary.hidden = false;
    // 上传在途期间保持禁用，避免并发创建批次
    els.uploadBtn.disabled = uploadInFlight;
  }

  function acceptFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    selectedFiles = files;
    clearPageStatus();
    updateSelectedSummary();
  }

  async function upload() {
    if (selectedFiles.length === 0 || uploadInFlight) return;
    uploadInFlight = true;
    els.uploadBtn.disabled = true;

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append('images', file, file.name);
    }

    try {
      const res = await fetch('api/batches', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        throw new Error((body.error && body.error.message) || `上传失败（HTTP ${res.status}）`);
      }
      selectedFiles = [];
      els.fileInput.value = '';
      clearPageStatus();
      batchId = body.batch_id;
      rejectionModalShown.clear();
      renderCards(body.images.map((image) => ({ image_id: image.image_id, status: image.status })));
      els.batchSection.hidden = false;
      els.batchTitle.textContent = `批次 ${body.batch_id.slice(0, 8)}…`;
      startPolling();
    } catch (err) {
      showPageStatus(err.message);
    } finally {
      uploadInFlight = false;
      updateSelectedSummary();
    }
  }

  // ---- 批次轮询与渲染 ----

  function startPolling() {
    stopPolling();
    pollErrorCount = 0;
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function poll() {
    if (!batchId) return;
    try {
      const res = await fetch(`api/batches/${batchId}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error((body.error && body.error.message) || `查询批次失败（HTTP ${res.status}）`);
      }
      pollErrorCount = 0;
      // 轮询恢复正常，清除此前的瞬时网络错误提示
      clearPageStatus();
      renderCards(body.images);
      // 批次内没有进行中的图片后停止轮询
      if (body.images.every((image) => TERMINAL_STATUSES.has(image.status))) {
        stopPolling();
      }
    } catch (err) {
      pollErrorCount += 1;
      showPageStatus(`查询批次状态失败，正在重试：${err.message}`);
      if (pollErrorCount >= MAX_POLL_ERRORS) {
        stopPolling();
        showPageStatus(`查询批次状态多次失败，已停止轮询：${err.message}`);
      }
    }
  }

  function renderCards(images) {
    els.cards.textContent = '';
    for (const image of images) {
      els.cards.appendChild(buildCard(image));
      if (image.status === 'REJECTED' && !rejectionModalShown.has(image.image_id)) {
        rejectionModalShown.add(image.image_id);
        showModal('该图片不是高中物理题，请重新上传');
      }
    }
  }

  function buildCard(image) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.imageId = image.image_id;

    const img = document.createElement('img');
    img.className = 'card-thumb';
    img.alt = '作业图片';
    if (image.status === 'SUCCEEDED') {
      // 仅结果图可放大：绑定点击/键盘激活与 cursor 类
      img.src = `api/images/${image.image_id}/result`;
      img.classList.add('is-clickable');
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', '放大查看批改结果');
      const openResult = () => openLightbox(image.image_id);
      img.addEventListener('click', openResult);
      img.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openResult();
        }
      });
      img.title = '点击放大查看批改结果';
    } else {
      img.src = `api/images/${image.image_id}/raw`;
    }
    card.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const badge = document.createElement('span');
    badge.className = `badge badge-${image.status}`;
    badge.textContent = STATUS_LABELS[image.status] || image.status;
    const idLabel = document.createElement('span');
    idLabel.className = 'card-id';
    idLabel.textContent = image.image_id.slice(0, 8);
    meta.appendChild(idLabel);
    meta.appendChild(badge);
    card.appendChild(meta);

    if (image.status === 'FAILED' && image.error_message) {
      const errorText = document.createElement('p');
      errorText.className = 'card-error';
      errorText.textContent = image.error_message;
      card.appendChild(errorText);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (image.status === 'FAILED') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'button button-danger';
      retryBtn.textContent = '重试';
      // 立即禁用防止双击重复提交；卡片随轮询重建会自然恢复
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        retryImage(image.image_id);
      });
      actions.appendChild(retryBtn);
    }
    if (image.status === 'SUCCEEDED') {
      const downloadLink = document.createElement('a');
      downloadLink.className = 'button button-secondary';
      downloadLink.textContent = '下载';
      downloadLink.href = `api/images/${image.image_id}/result`;
      downloadLink.download = `批改结果_${image.image_id.slice(0, 8)}.png`;
      actions.appendChild(downloadLink);
    }
    if (actions.childElementCount > 0) {
      card.appendChild(actions);
    }

    return card;
  }

  async function retryImage(imageId) {
    clearPageStatus();
    try {
      const res = await fetch(`api/images/${imageId}/retry`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        throw new Error((body.error && body.error.message) || `重试失败（HTTP ${res.status}）`);
      }
      startPolling();
    } catch (err) {
      showPageStatus(err.message);
    }
  }

  // ---- 模态框与灯箱 ----

  function showModal(message) {
    els.modalMessage.textContent = message;
    if (els.modal.classList.contains('hidden')) {
      modalReturnFocus = document.activeElement;
      els.modal.classList.remove('hidden');
    }
    els.modalClose.focus();
  }

  function closeModal() {
    els.modal.classList.add('hidden');
    const trigger = modalReturnFocus;
    modalReturnFocus = null;
    if (trigger && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  function openLightbox(imageId) {
    const url = `api/images/${imageId}/result`;
    els.lightboxImg.src = url;
    els.lightboxDownload.href = url;
    els.lightboxDownload.download = `批改结果_${imageId.slice(0, 8)}.png`;
    lightboxReturnFocus = document.activeElement;
    lightboxReturnImageId = imageId;
    els.lightbox.classList.remove('hidden');
    els.lightboxClose.focus();
  }

  function closeLightbox() {
    els.lightbox.classList.add('hidden');
    els.lightboxImg.src = '';
    const trigger = lightboxReturnFocus;
    const imageId = lightboxReturnImageId;
    lightboxReturnFocus = null;
    lightboxReturnImageId = null;
    if (trigger && trigger.isConnected) {
      trigger.focus();
      return;
    }
    // 轮询会重建卡片；原触发元素被移除时回落到同图的新缩略图
    const thumb = imageId
      ? document.querySelector(`.card[data-image-id="${imageId}"] .card-thumb`)
      : null;
    if (thumb) thumb.focus();
  }

  els.modalClose.addEventListener('click', closeModal);

  els.lightboxClose.addEventListener('click', closeLightbox);

  // Esc 关闭最上层的模态/灯箱
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!els.modal.classList.contains('hidden')) {
      closeModal();
    } else if (!els.lightbox.classList.contains('hidden')) {
      closeLightbox();
    }
  });

  // 点击遮罩空白处关闭
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeModal();
  });

  els.lightbox.addEventListener('click', (event) => {
    if (event.target === els.lightbox) closeLightbox();
  });

  // ---- 拖拽与选择 ----

  els.fileInput.addEventListener('change', () => acceptFiles(els.fileInput.files));

  els.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  });

  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('dragover');
  });

  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
    acceptFiles(event.dataTransfer.files);
  });

  els.uploadBtn.addEventListener('click', upload);
})();
