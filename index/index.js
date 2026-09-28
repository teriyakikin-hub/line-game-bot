const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

const userSessions = {};
const activeRecruitments = {};

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(200).end();
    });
});

async function handleEvent(event) {
  // ポストバックイベント（ボタンが押された時）
  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback.data);
    const action = data.get('action');
    const recId = data.get('recId');
    const userId = event.source.userId;
    const rec = activeRecruitments[recId];

    if (!rec) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'この募集は終了しているか、期限切れです。'
      });
    }

    // 締切権限チェック（作成者以外はメッセージ送信）
    if (action === 'close' && userId !== rec.ownerId) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '⚠️ 募集を締め切ることができるのは、募集を開始した本人のみです！'
      });
    }

    // ユーザー名取得
    let userName = 'メンバー';
    try {
      const profile = await client.getProfile(userId);
      userName = profile.displayName;
    } catch (e) {
      if (event.source.groupId) {
        try {
          const profile = await client.getGroupMemberProfile(event.source.groupId, userId);
          userName = profile.displayName;
        } catch (err) {}
      }
    }

    // データ更新
    if (action === 'join') {
      if (!rec.participants.includes(userName)) {
        rec.participants.push(userName);
      }
    } else if (action === 'leave') {
      rec.participants = rec.participants.filter(name => name !== userName);
    } else if (action === 'close') {
      rec.closed = true;
    }

    // ★重要: メッセージ更新 API を試行（元のカードを直接編集してメッセージを増やさない）
    try {
      // replyToken ではなく、元メッセージを直接アップデート
      await client.updateFlexMessage(event.message.id, {
        type: 'flex',
        altText: rec.closed ? `【募集終了】${rec.game}` : `【募集更新】${rec.game}`,
        contents: createFlexBubble(recId, rec)
      });
      return Promise.resolve(null);
    } catch (err) {
      // 万が一 updateFlexMessage が使えない環境（通常アカウント等）の場合は旧方式で返信
      return client.replyMessage(event.replyToken, {
        type: 'flex',
        altText: rec.closed ? `【募集終了】${rec.game}` : `【募集更新】${rec.game}`,
        contents: createFlexBubble(recId, rec)
      });
    }
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const text = event.message.text.trim();

  // 1. 一発募集コマンド (/募集 ゲーム 時間 人数)
  if (text.startsWith('/募集 ') || text.startsWith('募集 ')) {
    const args = text.split(/\s+/).slice(1);
    if (args.length >= 3) {
      return sendNewCard(event.replyToken, userId, args[0], args[1], args[2]);
    }
  }

  // 2. 対話募集スタート
  if (text === '募集' || text === '/募集') {
    userSessions[userId] = { step: 'GAME' };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🎮 どのゲームを募集しますか？',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'フォートナイト', text: 'フォートナイト' } },
          { type: 'action', action: { type: 'message', label: 'ロブロックス', text: 'ロブロックス' } },
          { type: 'action', action: { type: 'message', label: 'Among Us', text: 'Among Us' } },
          { type: 'action', action: { type: 'message', label: 'ブロスタ', text: 'ブロスタ' } },
          { type: 'action', action: { type: 'message', label: 'eFootball', text: 'eFootball' } },
          { type: 'action', action: { type: 'message', label: '💬 雑談', text: '雑談' } },
          { type: 'action', action: { type: 'message', label: '✨ その他', text: 'その他' } }
        ]
      }
    });
  }

  // 3. 対話ステップ処理
  if (userSessions[userId]) {
    const session = userSessions[userId];

    if (session.step === 'GAME') {
      session.game = text;
      session.step = 'TIME';
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `【${text}】ですね！\n何時から始めますか？（例: 21:00、今から）`
      });
    }

    if (session.step === 'TIME') {
      session.time = text;
      session.step = 'MEMBERS';
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '募集人数を入力してください（例: 3人なら「3」、制限なしなら「なし」）'
      });
    }

    if (session.step === 'MEMBERS') {
      const game = session.game;
      const time = session.time;
      const members = text;
      delete userSessions[userId];

      return sendNewCard(event.replyToken, userId, game, time, members);
    }
  }

  return Promise.resolve(null);
}

function sendNewCard(replyToken, ownerId, game, time, members) {
  const recId = Date.now().toString();
  const memberText = (members === 'なし' || members === '無制限') ? '制限なし' : `${members.replace('人', '')}人`;

  activeRecruitments[recId] = {
    ownerId: ownerId,
    game: game,
    time: time,
    members: memberText,
    participants: [],
    closed: false
  };

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: `【募集】${game} (${time}〜)`,
    contents: createFlexBubble(recId, activeRecruitments[recId])
  });
}

function createFlexBubble(recId, rec) {
  const participantNames = rec.participants.length > 0 
    ? rec.participants.join(', ') 
    : 'なし';

  const statusTitle = rec.closed ? '❌ 募集終了' : '🎮 メンバー募集！';
  const themeColor = rec.closed ? '#aaaaaa' : '#1DB446';

  const footerButtons = rec.closed ? [] : [
    {
      type: 'button',
      style: 'primary',
      color: '#1DB446',
      height: 'sm',
      action: {
        type: 'postback',
        label: '参加する！',
        data: `action=join&recId=${recId}`
      }
    },
    {
      type: 'button',
      style: 'secondary',
      height: 'sm',
      margin: 'xs',
      action: {
        type: 'postback',
        label: 'キャンセル',
        data: `action=leave&recId=${recId}`
      }
    },
    {
      type: 'button',
      style: 'link',
      color: '#ff4d4f',
      height: 'sm',
      action: {
        type: 'postback',
        label: '募集を締め切る（主のみ）',
        data: `action=close&recId=${recId}`
      }
    }
  ];

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: statusTitle, weight: 'bold', size: 'lg', color: themeColor },
        { type: 'text', text: rec.game, weight: 'bold', size: 'xl', margin: 'md' },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'sm',
          contents: [
            { type: 'text', text: `⏰ 開始時間: ${rec.time}`, size: 'sm', color: '#555555' },
            { type: 'text', text: `👥 定員: ${rec.members}`, size: 'sm', color: '#555555' },
            { type: 'text', text: `👤 参加者: ${participantNames}`, size: 'sm', color: '#1DB446', weight: 'bold', wrap: true }
          ]
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: footerButtons
    }
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


