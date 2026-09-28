const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// 募集データと対話セッションを保存するオブジェクト
const parties = {};
const userSessions = {};

// 5つの対応ゲームとカードの色設定
const GAMES = {
  'ロブロックス': { color: '#000000' },
  'フォートナイト': { color: '#1A73E8' },
  'アモングアス': { color: '#C62828' },
  'ブロスタ': { color: '#F57C00' },
  'イーフト': { color: '#2E7D32' }
};

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  const userId = event.source.userId;

  // --- 1. ボタンが押された時（Postback）の処理 ---
  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');

    // ゲーム選択（対話モード）
    if (action === 'step_game') {
      const gameName = params.get('game_name');
      userSessions[userId] = { step: 'WAITING_TIME', gameName: gameName };

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `【${gameName}】ですね！\n何時から始めますか？（例: 21:00、今から）`
      });
    }

    // 参加ボタン
    if (action === 'join') {
      const partyId = params.get('party_id');
      const party = parties[partyId];
      if (!party) return replyText(event.replyToken, '⚠️ この募集は終了しています。');

      let userName = await getUserName(userId);
      if (party.members.includes(userName)) return replyText(event.replyToken, 'すでに参加しています！');
      if (party.maxSize !== 'なし' && party.members.length >= parseInt(party.maxSize)) {
        return replyText(event.replyToken, '⚠️ すでに満員です！');
      }

      party.members.push(userName);
      return client.replyMessage(event.replyToken, buildPartyCard(partyId));
    }

    // 辞退ボタン
    if (action === 'leave') {
      const partyId = params.get('party_id');
      const party = parties[partyId];
      if (!party) return;

      let userName = await getUserName(userId);
      party.members = party.members.filter(m => m !== userName);
      return client.replyMessage(event.replyToken, buildPartyCard(partyId));
    }
  }

  // --- 2. メッセージが送られた時の処理 ---
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    // 【使い方B】1行ショートカット (/募集 ゲーム名 時間 人数)
    if (text.startsWith('/募集') || text.startsWith('募集 ')) {
      const parts = text.split(/\s+/);
      if (parts.length >= 3) {
        const inputGame = parts[1];
        const time = parts[2];
        const sizeInput = parts[3] ? parts[3].replace(/人/g, '') : 'なし';

        let matchedGame = Object.keys(GAMES).find(g => inputGame.includes(g)) || 'フォートナイト';
        const partyId = Date.now().toString();
        const hostName = await getUserName(userId);

        parties[partyId] = {
          gameName: matchedGame,
          time: time,
          maxSize: isNaN(sizeInput) ? 'なし' : sizeInput,
          members: [hostName]
        };

        return client.replyMessage(event.replyToken, buildPartyCard(partyId));
      }
    }

    // 【使い方A】「募集」で対話モード開始
    if (text === '募集' || text === '/募集') {
      userSessions[userId] = { step: 'WAITING_GAME' };
      return client.replyMessage(event.replyToken, buildGameSelectQuickReply());
    }

    // 対話モード進行中の返信処理
    const session = userSessions[userId];
    if (session) {
      if (session.step === 'WAITING_TIME') {
        session.time = text;
        session.step = 'WAITING_SIZE';
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '募集人数を入力してください（例: 3人なら「3」、制限なしなら「なし」）'
        });
      }

      if (session.step === 'WAITING_SIZE') {
        const sizeInput = text.replace(/人/g, '');
        const maxSize = isNaN(sizeInput) ? 'なし' : sizeInput;
        const partyId = Date.now().toString();
        const hostName = await getUserName(userId);

        parties[partyId] = {
          gameName: session.gameName,
          time: session.time,
          maxSize: maxSize,
          members: [hostName]
        };

        delete userSessions[userId];
        return client.replyMessage(event.replyToken, buildPartyCard(partyId));
      }
    }
  }
}

// LINEからユーザー名を取得する関数
async function getUserName(userId) {
  try {
    const profile = await client.getProfile(userId);
    return profile.displayName;
  } catch (e) {
    return 'メンバー';
  }
}

// 簡易返信用関数
function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text: text });
}

// ゲーム選択ボタン（クイックリプライ）生成
function buildGameSelectQuickReply() {
  return {
    type: 'text',
    text: '🎮 どのゲームを募集しますか？ボタンから選んでね！',
    quickReply: {
      items: Object.keys(GAMES).map(name => ({
        type: 'action',
        action: {
          type: 'postback',
          label: name,
          data: `action=step_game&game_name=${name}`,
          displayText: name
        }
      }))
    }
  };
}

// 募集カード（Flex Message）生成
function buildPartyCard(partyId) {
  const party = parties[partyId];
  const gameConfig = GAMES[party.gameName] || { color: '#1A73E8' };
  const isFull = party.maxSize !== 'なし' && party.members.length >= parseInt(party.maxSize);
  const memberList = party.members.map((m, i) => `${i + 1}. ${m}`).join('\n');

  return {
    type: 'flex',
    altText: `【募集】${party.gameName} (${party.time}〜)`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: gameConfig.color,
        contents: [
          { type: 'text', text: isFull ? '🔥 満員御礼！' : '🎮 メンバー募集', color: '#FFFFFF', weight: 'bold', size: 'sm' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: party.gameName, weight: 'bold', size: 'xl' },
          { type: 'text', text: `⏰ 開始: ${party.time}`, size: 'sm', color: '#555555', margin: 'xs' },
          { type: 'text', text: `👤 定員: ${party.maxSize === 'なし' ? '制限なし' : party.maxSize + '人'}`, size: 'sm', color: '#555555' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '【現在の参加者】', size: 'xs', color: '#aaaaaa', margin: 'md' },
          { type: 'text', text: memberList, size: 'sm', wrap: true, margin: 'xs' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: gameConfig.color,
            action: { type: 'postback', label: '参加', data: `action=join&party_id=${partyId}` },
            disabled: isFull
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: '辞退', data: `action=leave&party_id=${partyId}` }
          }
        ]
      }
    }
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


