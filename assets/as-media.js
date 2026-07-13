/* =========================================================================
   CLAPA A/S 첨부 미디어 헬퍼 (as-media.js)
   - 접수 폼(index.html)·접수 조회 대화창(as-status.js) 공용
   - 공개 API: window.ClapaAsMedia = { compressImage, fileToB64 }
   ========================================================================= */
(function () {
  'use strict';

  /* 사진을 최대 변 maxSide(px)·품질 q 의 JPEG으로 재압축합니다.
     디코딩 실패(HEIC 미지원 브라우저 등)·인코딩 실패 시 reject —
     원본 폴백(크기 상한 판단)은 호출부 책임입니다. */
  function compressImage(file, maxSide, q) {
    if (maxSide == null) maxSide = 1600;
    if (q == null) q = 0.8;
    return new Promise(function (resolve, reject) {
      var url;
      try { url = URL.createObjectURL(file); } catch (e) { reject(e); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('decode')); return; }
          var scale = Math.min(1, maxSide / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('encode')); return; }
            var name = String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
            resolve({ blob: blob, name: name, mime: 'image/jpeg' });
          }, 'image/jpeg', q);
        } catch (e2) { try { URL.revokeObjectURL(url); } catch (e3) {} reject(e2); }
      };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} reject(new Error('decode')); };
      img.src = url;
    });
  }

  /* Blob → base64 (data: 접두어 제거) */
  function fileToB64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = function () { reject(fr.error || new Error('read')); };
      fr.readAsDataURL(blob);
    });
  }

  window.ClapaAsMedia = { compressImage: compressImage, fileToB64: fileToB64 };
})();
