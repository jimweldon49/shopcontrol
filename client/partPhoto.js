// Part photos (office program and employee app): one small picture per part so techs know
// what they're looking for. Photos are shrunk on the device before upload (longest side
// 640px, JPEG ~0.7, usually 40–80 KB) so lists stay fast; the server refuses anything over
// 800 KB. API: POST /api/uploads/parts/:id, DELETE /api/uploads/parts/:id/photo.
const PartPhoto = (() => {
  const MAX_SIDE = 640, QUALITY = 0.7;
  const token = () => (typeof authToken !== "undefined" && authToken) || localStorage.getItem("authToken");
  const escAttr = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error("That picture couldn't be read.")); i.src = url; });
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    } finally { URL.revokeObjectURL(url); }
  }

  async function upload(partId, file) {
    const blob = await shrink(file);
    const form = new FormData();
    form.append("file", blob, "part.jpg");
    form.append("note", "Part photo");
    const res = await fetch(`/api/uploads/parts/${partId}`, { method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(body.error || "The photo didn't upload.");
    return body.file_url;
  }

  async function remove(partId) {
    const res = await fetch(`/api/uploads/parts/${partId}/photo`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw Error((await res.json().catch(() => ({}))).error || "Couldn't remove the photo.");
  }

  // Opens the camera on a phone (a file picker on a computer); resolves with the new URL.
  function take(partId) {
    return new Promise((resolve, reject) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
      input.setAttribute("capture", "environment");
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        try { resolve(await upload(partId, file)); } catch (err) { reject(err); }
      };
      input.click();
    });
  }

  // A small square thumbnail that opens the bigger picture. Lazy-loaded so long lists stay quick.
  // A span, not a button: it sits inside tappable rows (a button can't contain a button).
  // The URL and name ride in data attributes; taps are handled by the listener below.
  function thumb(url, label, size = 52) {
    if (!url) return "";
    return `<span role="button" tabindex="0" class="part-thumb" style="width:${size}px;height:${size}px" data-photo="${escAttr(url)}" data-label="${escAttr(label)}" aria-label="See the photo of ${escAttr(label)}"><img src="${escAttr(url)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  // Capture phase, so the tap opens the photo instead of whatever row the thumbnail sits in.
  const open = (ev) => {
    const t = ev.target.closest && ev.target.closest(".part-thumb[data-photo]");
    if (!t || (ev.type === "keydown" && ev.key !== "Enter")) return;
    ev.stopPropagation(); ev.preventDefault();
    view(t.dataset.photo, t.dataset.label || "");
  };
  document.addEventListener("click", open, true);
  document.addEventListener("keydown", open, true);

  function view(url, label) {
    const box = document.createElement("div");
    box.className = "part-photo-view";
    box.innerHTML = `<figure><img src="${escAttr(url)}" alt="${escAttr(label)}"><figcaption>${escAttr(label)}</figcaption></figure><button type="button" aria-label="Close">✕</button>`;
    box.onclick = () => box.remove();
    document.body.append(box);
  }

  return { shrink, upload, remove, take, thumb, view };
})();
