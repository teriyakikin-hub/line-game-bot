const express = require('express');
const line = require('@line/bot-sdk');
const path = require('path');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.CHANNEL_SECRET || ''
};

const client = new line.Client(config);
const app = express();

const userSessions = {};
const activeRecruitments = {};

// 1. LIFF用のWebページを提供
app.get('/liff', (req, res) => {
  res.sendFile(path.join(__dirname, 'liff.html'));
});

// 2. LIFFからのデータ取得・操作用API
app.use('/api', express.json());

app.get('/api/recruitment/:id', (req, res) => {
  const rec = activeRecruitments[req.params.id];
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

app.post('/api/action', (req, res) => {
  const { recId, userId, userName, action } = req.body;
  const rec = activeRecruitments[recId];

  if (!rec) return res.status(400).json({ error: '募集が存在しないか終了しています。' });

  if (action === 'close' && userId !== rec.ownerId) {
    return res.status(403).json({ error: '募集主しか締め切れません！' });
  }

  if (action === 'join') {
    if (!rec.participants.includes(userName)) {
      rec.participants.push(userName);
    }
  } else if (action === 'leave') {
    rec.participants = rec.participants.filter(name => name !== userName);
  } else if (action === 'close') {
    rec.closed = true;
  }

  res.json({ success: true, rec });
});

// 3. LINE Webhook処理（express.jsonは通さず直接ミドルウェアに渡す）
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(200).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const text = event.message.text.trim();

  if (text.startsWith('/募集 ') || text.startsWith('募集 ')) {
    const args = text.split(/\s+/).slice(1);
    if (args.length >= 3) {
      return sendNewCard(event.replyToken, userId, args[0], args[1], args[2]);
    }
  }

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

  const liffId = process.env.LIFF_ID || '';
  const liffUrl = liffId ? `https://liff.line.me/${liffId}?recId=${recId}` : 'https://line.me';

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: `【募集】${game} (${time}〜)`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🎮 メンバー募集！', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: game, weight: 'bold', size: 'xl', margin: 'md' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: `⏰ 開始時間: ${time}`, size: 'sm', color: '#555555' },
              { type: 'text', text: `👥 定員: ${memberText}`, size: 'sm', color: '#555555' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            action: {
              type: 'uri',
              label: '参加・確認・管理する',
              uri: liffUrl
            }
          }
        ]
      }
    }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));



