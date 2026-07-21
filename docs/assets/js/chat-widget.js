(function () {
  function initChat() {
    var toggleBtn = document.getElementById('chat-toggle');
    var chatWindow = document.getElementById('chat-window');
    var sendBtn = document.getElementById('chat-send-btn');
    var input = document.getElementById('chat-widget-input');
    var messages = document.getElementById('chat-messages');

    if (!toggleBtn || !chatWindow || !sendBtn || !input || !messages) return;

    toggleBtn.addEventListener('click', function () {
      chatWindow.style.display =
        chatWindow.style.display === 'none' || chatWindow.style.display === ''
          ? 'flex'
          : 'none';
    });

    input.addEventListener('keyup', function (e) {
      if (e.key === 'Enter') sendChatMessage();
    });

    sendBtn.addEventListener('click', sendChatMessage);

    messages.addEventListener('click', function (e) {
      var fallbackBtn = e.target.closest('.chat-fallback-email-btn');
      if (fallbackBtn) {
        var question = fallbackBtn.getAttribute('data-question');
        sendEmailSupport(question);
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderEmailFallback(question) {
      messages.insertAdjacentHTML(
        'beforeend',
        '<div style="margin-bottom:12px; text-align:center;">' +
          '<button class="chat-fallback-email-btn" data-question="' +
          escapeHtml(question) +
          '" style="background:#007acc; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">' +
          '✉️ Email question to team' +
          '</button>' +
          '</div>'
      );
    }

    async function sendChatMessage() {
      var question = input.value.trim();
      if (!question) return;

      messages.insertAdjacentHTML(
        'beforeend',
        '<div style="margin-bottom:12px; text-align:right;">' +
          '<span style="background:#007acc; color:white; padding:8px 12px; border-radius:14px 14px 0 14px; display:inline-block; max-width:80%; text-align:left;">' +
          escapeHtml(question) +
          '</span>' +
          '</div>'
      );
      input.value = '';

      var loadingId = 'l-' + Date.now();
      messages.insertAdjacentHTML(
        'beforeend',
        '<div id="' +
          loadingId +
          '" style="margin-bottom:12px;">' +
          '<span style="background:#3e3d42; color:#aaa; padding:8px 12px; border-radius:14px 14px 14px 0; display:inline-block;">' +
          'Thinking...' +
          '</span>' +
          '</div>'
      );
      messages.scrollTop = messages.scrollHeight;

      try {
        var res = await fetch(
          'https://docs-rag-bot.thetechnicalwriter.workers.dev/chat',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question }),
          }
        );

        var data = await res.json();
        var loader = document.getElementById(loadingId);
        if (loader) loader.remove();

        messages.insertAdjacentHTML(
          'beforeend',
          '<div style="margin-bottom:12px;">' +
            '<span style="background:#3e3d42; color:#eee; padding:8px 12px; border-radius:14px 14px 14px 0; display:inline-block; max-width:80%; line-height:1.4;">' +
            escapeHtml(data.answer || 'No response generated.') +
            '</span>' +
            '</div>'
        );

        if (data.status === 'error' || data.status === 'flagged') {
          renderEmailFallback(question);
        }
      } catch (err) {
        var loaderErr = document.getElementById(loadingId);
        if (loaderErr) loaderErr.remove();

        messages.insertAdjacentHTML(
          'beforeend',
          '<div style="margin-bottom:12px;">' +
            '<span style="background:#5c2529; color:#ff8a80; padding:8px 12px; border-radius:14px; display:inline-block; font-size:13px;">' +
            'Error connecting to assistant.' +
            '</span>' +
            '</div>'
        );
        renderEmailFallback(question);
      }
      messages.scrollTop = messages.scrollHeight;
    }

    async function sendEmailSupport(question) {
      var email = prompt(
        'Please enter your email so we can reply back to you:'
      );
      if (!email) return;

      try {
        var res = await fetch(
          'https://docs-rag-bot.thetechnicalwriter.workers.dev/email-support',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: question,
              userEmail: email,
              conversation: messages.innerText,
            }),
          }
        );

        if (res.ok) {
          messages.insertAdjacentHTML(
            'beforeend',
            '<div style="margin-bottom:12px; text-align:center; color:#4caf50; font-size:13px;">' +
              "✓ Support email sent! We'll get back to you soon." +
              '</div>'
          );
        } else {
          throw new Error();
        }
      } catch (e) {
        alert('Failed to send email. Please try again later.');
      }
      messages.scrollTop = messages.scrollHeight;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
