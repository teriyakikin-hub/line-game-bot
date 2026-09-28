const express = require('express');
const line = require('@line-bot-sdk');
const path = require('path');
const cron = require('node-cron'); // ★機能3: 時間監視用

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
});

const app = express();

// メモリ上で募集データを管理
const activeRecruitments = {};

// 静的ファイルの提供（LIFF用 html 等）
app.use(express.static(path.join(__dirname, 'public')));

// Webhookの署名検証ミドルウェア
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// LIFFアプリからのAPIリクエスト用（JSONパース）
app.use(express.json());

// --- 募集情報の取得 API ---
app.get('/api/recruitment/:id', (req, res) => {
  const rec = activeRecruitments[req.params.id];
  if (!rec) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(rec);
});

// --- 【機能1】参加 / キャンセル / 締め切り / 人数制限チェック API ---
app.post('/api/action', (req, res) => {
  const { recId, userId, userName, action } = req.body;
  const rec = activeRecruitments[recId];

  if (!rec) return res.status(400).json({ error: '募集が存在しないか終了しています。' });

  // 締め切り権限チェック（募集主のみ）
  if (action === 'close' && userId !== rec.ownerId) {
    return res.status(403).json({ error: '募集主しか締め切れません！' });
  }

  if (action === 'join') {
    if (!rec.participants.includes(userName)) {
      
      // ★人数制限のチェック処理
      if (rec.members !== '制限なし') {
        const maxMembers = parseInt(rec.members.replace('人', ''), 10);
        if (!isNaN(maxMembers) && rec.participants.length >= maxMembers) {
          return res.status(400).json({ error: '定員に達しているため参加できません！💦' });
        }
      }
      
      rec.participants.push(userName);
    }
  } else if (action === 'leave') {
    rec.participants = rec.participants.filter(name => name !== userName);
  } else if (action === 'close') {
    rec.closed = true;
  }

  res.json({ success: true, rec });
});

// --- LINE Webhookイベント処理 ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const groupId = event.source.groupId || event.source.roomId || userId;

  // ユーザー名を取得
  let userName = 'ゲスト';
  try {
    if (event.source.groupId) {
      const profile = await client.getGroupMemberProfile(event.source.groupId, userId);
      userName = profile.displayName;
    } else {
      const profile = await client.getUserProfile(userId);
      userName = profile.displayName;
    }
  } catch (e) {
    console.log('プロフィール取得エラー:', e);
  }

  // --- 一発コマンド処理 (/募集 [ゲーム名] [時間] [人数]) ---
  if (text.startsWith('/募集')) {
    const args = text.split(/\s+/);
    const game = args[1] || 'ゲーム';
    const time = args[2] || '今から';
    const members = args[3] || '制限なし';

    const recId = 'rec_' + Date.now();
    activeRecruitments[recId] = {
      game: game,
      time: time,
      members: members,
      ownerId: userId,
      groupId: groupId,
      participants: [userName],
      closed: false,
      notified: false,       // ★【機能3】通知済みフラグ
      createdAt: Date.now()   // ★【機能2】30日自動削除用の作成日時
    };

    const liffUrl = `https://liff.line.me/${process.env.LIFF_ID}?recId=${recId}`;

    const flexMsg = {
      type: 'flex',
      altText: `🎮 ${game} のメンバー募集！`,
      contents: {
        type: 'bubble',
        styles: { header: { backgroundColor: '#FF6B6B' } },
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🎮 メンバー募集中！', weight: 'bold', color: '#FFFFFF', size: 'sm' },
            { type: 'text', text: game, weight: 'bold', color: '#FFFFFF', size: 'xl', margin: 'xs' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `⏰ 時間: ${time}`, size: 'sm', weight: 'bold' },
            { type: 'text', text: `👥 募集人数: ${members}`, size: 'sm', weight: 'bold', margin: 'xs' },
            { type: 'text', text: `👑 募集主: ${userName}`, size: 'xs', color: '#888888', margin: 'md' }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: { type: 'uri', label: '参加・確認・管理する', uri: liffUrl },
              style: 'primary',
              color: '#2EC4B6'
            }
          ]
        }
      }
    };

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [flexMsg]
    });
  }
}

// --- 【機能2】30日経過した古い募集データの自動クリーンアップ ---
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
function cleanupOldRecruitments() {
  const now = Date.now();
  Object.keys(activeRecruitments).forEach((recId) => {
    const rec = activeRecruitments[recId];
    if (rec.createdAt && (now - rec.createdAt > THIRTY_DAYS_MS)) {
      delete activeRecruitments[recId];
      console.log(`[自動削除] 30日経過した古い募集を削除しました: ${recId}`);
    }
  });
}
// 24時間に1回クリーンアップを実行
setInterval(cleanupOldRecruitments, 24 * 60 * 60 * 1000);

// --- 【機能3】指定時間になったら自動で結果カードを送信 ---
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentHHMM = now.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  for (const recId in activeRecruitments) {
    const rec = activeRecruitments[recId];

    if (!rec.notified && rec.time === currentHHMM && rec.groupId) {
      rec.notified = true;
      rec.closed = true;

      const memberList = rec.participants.length > 0
        ? rec.participants.map((name, i) => `${i + 1}. ${name}`).join('\n')
        : '参加者がいませんでした💦';

      const resultMessage = {
        type: 'flex',
        altText: `【時間になりました！】${rec.game} のメンバー確定！`,
        contents: {
          type: 'bubble',
          styles: { header: { backgroundColor: '#4ECDC4' } },
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '⏰ 時間になりました！結果発表 🎮', weight: 'bold', color: '#FFFFFF', size: 'sm' },
              { type: 'text', text: rec.game, weight: 'bold', color: '#FFFFFF', size: 'xl', margin: 'xs' }
            ]
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: `募集人数: ${rec.members}`, size: 'xs', color: '#888888' },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: '✨ 本日の確定メンバー', weight: 'bold', size: 'sm', margin: 'md', color: '#2D3748' },
              { type: 'text', text: memberList, size: 'sm', color: '#4A5568', wrap: true, margin: 'sm' }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '準備してゲームに参加しよう！🚀', size: 'xs', color: '#A0AEC0', align: 'center' }
            ]
          }
        }
      };

      try {
        await client.pushMessage({
          to: rec.groupId,
          messages: [resultMessage]
        });
        console.log(`[結果カード送信完了] ${recId} -> ${rec.groupId}`);
      } catch (err) {
        console.error('結果カード送信エラー:', err);
      }
    }
  }
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



