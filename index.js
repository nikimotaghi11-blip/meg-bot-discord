const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GIVE_SECRET = process.env.MEG_GIVE_SECRET;
const DATA_FILE = "./data.json";

// ── Data persistence ──────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { balances: {}, usernames: {}, quests: {}, inventory: {} }; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
let data = loadData();

function getBalance(userId) { return data.balances[userId] ?? 1000; }
function setBalance(userId, amount) { data.balances[userId] = Math.max(0, amount); saveData(data); }
function addBalance(userId, amount) { const next = Math.max(0, getBalance(userId) + amount); setBalance(userId, next); return next; }
function hasEnough(userId, amount) { return getBalance(userId) >= amount; }
function registerUsername(userId, username) { data.usernames[userId] = username; saveData(data); }
function getLeaderboard() {
  return Object.entries(data.balances)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, bal]) => ({ username: data.usernames[id] || id.slice(0, 6), balance: bal }));
}

// ── Quests ────────────────────────────────────────────────────────
const QUEST_DEFS = [
  { id: "flip_winner",   name: "Flip Winner",    desc: "Win 3 coin flips",        goal: 3, reward: 300  },
  { id: "high_roller",   name: "High Roller",    desc: "Play any 5 games",         goal: 5, reward: 250  },
  { id: "blackjack_win", name: "Beat the House", desc: "Win at Blackjack",         goal: 1, reward: 500  },
  { id: "roulette_win",  name: "Spin Doctor",    desc: "Win at Roulette",          goal: 1, reward: 400  },
  { id: "slots_jackpot", name: "Lucky Gems",     desc: "Hit a Jackpot on Slots",   goal: 1, reward: 1000 },
  { id: "big_spender",   name: "Big Spender",    desc: "Bet 1,000 💎 in one game", goal: 1, reward: 350  },
];
function todayKey() { return new Date().toISOString().slice(0, 10); }
function trackEvent(userId, questId, amount = 1) {
  const today = todayKey();
  if (!data.quests[userId]) data.quests[userId] = {};
  const q = data.quests[userId][questId];
  if (q && q.day !== today) { delete data.quests[userId][questId]; }
  const existing = data.quests[userId][questId];
  if (existing?.completed) return [];
  const def = QUEST_DEFS.find(d => d.id === questId);
  const progress = (existing?.progress ?? 0) + amount;
  const completed = progress >= def.goal;
  data.quests[userId][questId] = { progress, completed, day: today };
  saveData(data);
  return completed && !existing?.completed ? [questId] : [];
}
function getQuestReward(questId) { return QUEST_DEFS.find(d => d.id === questId)?.reward ?? 0; }
function getQuestStatus(userId) {
  const today = todayKey();
  const userQ = data.quests[userId] ?? {};
  return QUEST_DEFS.map(def => {
    const q = userQ[def.id];
    const todayQ = q?.day === today ? q : null;
    return { def, progress: todayQ?.progress ?? 0, completed: todayQ?.completed ?? false };
  });
}

// ── Inventory ─────────────────────────────────────────────────────
function getInventory(userId) { return data.inventory[userId] ?? []; }
function addToInventory(userId, animal) {
  if (!data.inventory[userId]) data.inventory[userId] = [];
  data.inventory[userId].push(animal);
  saveData(data);
}
function clearInventory(userId) {
  const inv = data.inventory[userId] ?? [];
  data.inventory[userId] = [];
  saveData(data);
  return inv;
}

// ── Prayer ────────────────────────────────────────────────────────
const prayStates = new Map();
function getPray(userId) { return prayStates.get(userId) ?? { boostUntil: 0, nextAt: 0 }; }
function isBlessed(userId) { return Date.now() < getPray(userId).boostUntil; }
function canPray(userId) { return Date.now() >= getPray(userId).nextAt; }
function activatePrayer(userId) { const now = Date.now(); prayStates.set(userId, { boostUntil: now + 300000, nextAt: now + 600000 }); }
function timeLeft(ms) { const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000); return m > 0 ? `${m}m ${s}s` : `${s}s`; }

// ── Daily ─────────────────────────────────────────────────────────
const dailyCooldowns = new Map();

// ── Parse bet ─────────────────────────────────────────────────────
function parseBet(userId, args) {
  const first = args[0]?.toLowerCase();
  if (!first) return NaN;
  if (first === "all") return getBalance(userId);
  return parseInt(first.replace(/,/g, ""), 10);
}
function betArgCount(args) {
  return args[0]?.toLowerCase() === "all" && args[1]?.toLowerCase() === "in" ? 2 : 1;
}

// ── Animate ───────────────────────────────────────────────────────
async function animate(message, frames, delayMs = 800) {
  const sent = await message.reply(frames[0]);
  for (let i = 1; i < frames.length; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    try { await sent.edit(frames[i]); } catch {}
  }
}

// ── Coin flip ─────────────────────────────────────────────────────
async function coinflip(message, args) {
  const userId = message.author.id;
  const bet = parseBet(userId, args);
  if (!args.length || isNaN(bet) || bet <= 0) { await message.reply("Usage: `Meg cf <amount|all>`"); return; }
  if (!hasEnough(userId, bet)) { await message.reply(`Not enough 💎! Balance: **${getBalance(userId).toLocaleString()} 💎**`); return; }
  const blessed = isBlessed(userId);
  const win = Math.random() < (blessed ? 0.65 : 0.5);
  const newBal = addBalance(userId, win ? bet : -bet);
  const bonuses = [];
  if (bet >= 1000) for (const q of trackEvent(userId, "big_spender")) { const r = getQuestReward(q); addBalance(userId, r); bonuses.push(`🎯 **Big Spender** +${r.toLocaleString()} 💎`); }
  trackEvent(userId, "high_roller");
  if (win) for (const q of trackEvent(userId, "flip_winner")) { const r = getQuestReward(q); addBalance(userId, r); bonuses.push(`🎯 **Flip Winner** +${r.toLocaleString()} 💎`); }
  const result = win
    ? `🪙 **HEADS**${blessed?" 🙏":""}\n\n✅ **${message.author.username}** wins **${bet.toLocaleString()} 💎**!\nBalance: **${newBal.toLocaleString()} 💎**`
    : `🌑 **TAILS**${blessed?" 🙏":""}\n\n❌ **${message.author.username}** loses **${bet.toLocaleString()} 💎**.\nBalance: **${newBal.toLocaleString()} 💎**`;
  await animate(message, ["🌀 **Flipping...**", "🪙 **Spinning...**", "💫 **Oooooh...**", result + (bonuses.length ? "\n" + bonuses.join("\n") : "")]);
}

// ── Dice ──────────────────────────────────────────────────────────
const DICE = { 1:"⚀",2:"⚁",3:"⚂",4:"⚃",5:"⚄",6:"⚅" };
async function dice(message, args) {
  const userId = message.author.id;
  const bet = parseBet(userId, args);
  if (!args.length || isNaN(bet) || bet <= 0) { await message.reply("Usage: `Meg dice <amount|all>`"); return; }
  if (!hasEnough(userId, bet)) { await message.reply(`Not enough 💎! Balance: **${getBalance(userId).toLocaleString()} 💎**`); return; }
  const blessed = isBlessed(userId);
  let p = Math.floor(Math.random()*6)+1;
  const m = Math.floor(Math.random()*6)+1;
  if (blessed) p = Math.min(6, p+1);
  const bonuses = [];
  if (bet >= 1000) for (const q of trackEvent(userId, "big_spender")) { const r = getQuestReward(q); addBalance(userId, r); bonuses.push(`🎯 **Big Spender** +${r.toLocaleString()} 💎`); }
  trackEvent(userId, "high_roller");
  let newBal, result;
  if (p > m) { newBal = addBalance(userId, bet); result = `✅ **${message.author.username}** wins **${bet.toLocaleString()} 💎**!`; }
  else if (m > p) { newBal = addBalance(userId, -bet); result = `❌ **${message.author.username}** loses **${bet.toLocaleString()} 💎**.`; }
  else { newBal = getBalance(userId); result = `🤝 **TIE** — no change.`; }
  const line = `You: ${DICE[p]} **${p}**${blessed?" 🙏":""}  Meg: ${DICE[m]} **${m}**\n\n${result}\nBalance: **${newBal.toLocaleString()} 💎**`;
  await animate(message, ["🎲 **Rolling...**", `🎲 You: ${DICE[Math.ceil(Math.random()*6)]}  Meg: ${DICE[Math.ceil(Math.random()*6)]}`, line + (bonuses.length ? "\n"+bonuses.join("\n") : "")]);
}

// ── Slots ─────────────────────────────────────────────────────────
const SYMS = ["🍒","🍋","🍊","🍇","⭐","💎","7️⃣"];
const MULTS = {"🍒":2,"🍋":3,"🍊":4,"🍇":5,"⭐":8,"💎":15,"7️⃣":50};
async function slots(message, args) {
  const userId = message.author.id;
  const bet = parseBet(userId, args);
  if (!args.length || isNaN(bet) || bet <= 0) { await message.reply("Usage: `Meg s <amount|all>`"); return; }
  if (!hasEnough(userId, bet)) { await message.reply(`Not enough 💎! Balance: **${getBalance(userId).toLocaleString()} 💎**`); return; }
  const blessed = isBlessed(userId);
  const spin = () => SYMS[Math.floor(Math.random()*SYMS.length)];
  let a = spin(), b = spin(), c = spin();
  if (blessed && Math.random()<0.35) b=a;
  if (blessed && Math.random()<0.20) { b=a; c=a; }
  const bonuses = [];
  if (bet>=1000) for (const q of trackEvent(userId,"big_spender")) { const r=getQuestReward(q); addBalance(userId,r); bonuses.push(`🎯 **Big Spender** +${r.toLocaleString()} 💎`); }
  trackEvent(userId,"high_roller");
  let newBal, result;
  const disp = (x,y,z) => `[ ${x} | ${y} | ${z} ]`;
  if (a===b&&b===c) {
    const multi = MULTS[a]??2;
    newBal = addBalance(userId, bet*(multi-1));
    result = `🎰 ${disp(a,b,c)}\n\n🎉 **JACKPOT!** **${message.author.username}** wins **${(bet*(multi-1)).toLocaleString()} 💎** (${multi}x)!\nBalance: **${newBal.toLocaleString()} 💎**`;
    for (const q of trackEvent(userId,"slots_jackpot")) { const r=getQuestReward(q); addBalance(userId,r); bonuses.push(`🎯 **Lucky Gems** +${r.toLocaleString()} 💎`); }
  } else if (a===b||b===c||a===c) {
    newBal = addBalance(userId, Math.floor(bet*0.5));
    result = `🎰 ${disp(a,b,c)}\n\n🙂 Two of a kind! +**${Math.floor(bet*0.5).toLocaleString()} 💎**\nBalance: **${newBal.toLocaleString()} 💎**`;
  } else {
    newBal = addBalance(userId, -bet);
    result = `🎰 ${disp(a,b,c)}\n\n💸 No match. -**${bet.toLocaleString()} 💎**\nBalance: **${newBal.toLocaleString()} 💎**`;
  }
  await animate(message, [`🎰 ${disp("🌀","🌀","🌀")}`, `🎰 ${disp(a,"🌀","🌀")}`, `🎰 ${disp(a,b,"🌀")}`, result+(bonuses.length?"\n"+bonuses.join("\n"):"")], 700);
}

// ── Roulette ──────────────────────────────────────────────────────
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function spinColor(n) { return n===0?"green":REDS.has(n)?"red":"black"; }
const CE = {red:"🔴",black:"⚫",green:"🟢"};
async function roulette(message, args) {
  const userId = message.author.id;
  if (args.length < 2) { await message.reply("Usage: `Meg r <amount|all> <red|black|green|0-36>`"); return; }
  const bet = parseBet(userId, args);
  if (isNaN(bet)||bet<=0) { await message.reply("Invalid bet."); return; }
  if (!hasEnough(userId, bet)) { await message.reply(`Not enough 💎! Balance: **${getBalance(userId).toLocaleString()} 💎**`); return; }
  const choice = args[betArgCount(args)]?.toLowerCase();
  if (!choice) { await message.reply("Specify: red, black, green, or 0-36"); return; }
  const blessed = isBlessed(userId);
  let spin = Math.floor(Math.random()*37);
  if (blessed && Math.random()<0.30) {
    if (choice==="red") { const r=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]; spin=r[Math.floor(Math.random()*r.length)]; }
    else if (choice==="black") { const b=[2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]; spin=b[Math.floor(Math.random()*b.length)]; }
    else { const n=parseInt(choice,10); if(!isNaN(n)) spin=n; }
  }
  const sc = spinColor(spin);
  let win=false, multi=0;
  if (["red","black","green"].includes(choice)) { win=choice===sc; multi=choice==="green"?14:2; }
  else { const n=parseInt(choice,10); if(isNaN(n)||n<0||n>36){await message.reply("Invalid number.");return;} win=n===spin; multi=35; }
  const bonuses=[];
  if(bet>=1000) for(const q of trackEvent(userId,"big_spender")){const r=getQuestReward(q);addBalance(userId,r);bonuses.push(`🎯 **Big Spender** +${r.toLocaleString()} 💎`);}
  trackEvent(userId,"high_roller");
  let newBal, result;
  if (win) {
    newBal=addBalance(userId,bet*(multi-1));
    result=`${CE[sc]} **${spin}** (${sc})${blessed?" 🙏":""}\n\n✅ **${message.author.username}** wins **${(bet*(multi-1)).toLocaleString()} 💎** (${multi}x)!\nBalance: **${newBal.toLocaleString()} 💎**`;
    for(const q of trackEvent(userId,"roulette_win")){const r=getQuestReward(q);addBalance(userId,r);bonuses.push(`🎯 **Spin Doctor** +${r.toLocaleString()} 💎`);}
  } else {
    newBal=addBalance(userId,-bet);
    result=`${CE[sc]} **${spin}** (${sc})${blessed?" 🙏":""}\n\n❌ **${message.author.username}** loses **${bet.toLocaleString()} 💎**.\nBalance: **${newBal.toLocaleString()} 💎**`;
  }
  const rf=()=>{const ns=Array.from({length:5},()=>Math.floor(Math.random()*37));return "🎡 **Spinning...**\n"+ns.map(n=>`${CE[spinColor(n)]} ${n}`).join(" → ");};
  await animate(message, ["🎡 **Spinning the wheel...**", rf(), rf(), result+(bonuses.length?"\n"+bonuses.join("\n"):"")]);
}

// ── Blackjack ─────────────────────────────────────────────────────
const activePlayers = new Set();
function buildDeck(){const d=[];for(const s of["♠","♥","♦","♣"])for(const v of["A","2","3","4","5","6","7","8","9","10","J","Q","K"])d.push({s,v});for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}return d;}
function cardVal(v){if(v==="A")return 11;if(["J","Q","K"].includes(v))return 10;return parseInt(v,10);}
function handTotal(hand){let t=hand.reduce((s,c)=>s+cardVal(c.v),0),a=hand.filter(c=>c.v==="A").length;while(t>21&&a>0){t-=10;a--;}return t;}
function handStr(hand){return hand.map(c=>`${c.v}${c.s}`).join(" ")+` **(${handTotal(hand)})**`;}

async function blackjack(message, args) {
  const userId = message.author.id;
  if (!args.length) { await message.reply("Usage: `Meg bj <amount|all>`"); return; }
  if (activePlayers.has(userId)) { await message.reply("You have a game running! Type `hit` or `stand`."); return; }
  const bet = parseBet(userId, args);
  if (isNaN(bet)||bet<=0) { await message.reply("Invalid bet."); return; }
  if (!hasEnough(userId, bet)) { await message.reply(`Not enough 💎! Balance: **${getBalance(userId).toLocaleString()} 💎**`); return; }
  const blessed = isBlessed(userId);
  const deck = buildDeck();
  const ph=[deck.pop(),deck.pop()], dh=[deck.pop(),deck.pop()];
  const bonuses=[];
  if(bet>=1000)for(const q of trackEvent(userId,"big_spender")){const r=getQuestReward(q);addBalance(userId,r);bonuses.push(`🎯 **Big Spender** +${r.toLocaleString()} 💎`);}
  trackEvent(userId,"high_roller");
  const table=(hide)=>`🃏 **Blackjack**\nMeg's hand: ${hide?`${dh[0].v}${dh[0].s} 🂠 **(${cardVal(dh[0].v)} + ?)**`:handStr(dh)}\nYour hand:  ${handStr(ph)}`;
  if(handTotal(ph)===21){
    const w=Math.floor(bet*1.5),nb=addBalance(userId,w);
    for(const q of trackEvent(userId,"blackjack_win")){const r=getQuestReward(q);addBalance(userId,r);bonuses.push(`🎯 **Beat the House** +${r.toLocaleString()} 💎`);}
    await message.reply(`${table(false)}\n\n🎉 **Blackjack!** +**${w.toLocaleString()} 💎**!\nBalance: **${nb.toLocaleString()} 💎**`+(bonuses.length?"\n"+bonuses.join("\n"):""));
    return;
  }
  activePlayers.add(userId);
  try {
    await message.reply(`${table(true)}${blessed?" 🙏":""}\n\nBet: **${bet.toLocaleString()} 💎** | Type \`hit\` or \`stand\` *(30s)*`);
    while(true){
      let action="";
      try {
        const col=await message.channel.awaitMessages({filter:m=>m.author.id===userId&&["hit","h","stand","s","stop"].includes(m.content.toLowerCase().trim()),max:1,time:30000,errors:["time"]});
        action=col.first().content.toLowerCase().trim();
      } catch { await message.reply(`⏰ Time's up! Auto-standing...`); action="stand"; }
      if(action==="hit"||action==="h"){
        ph.push(deck.pop());
        const t=handTotal(ph);
        if(t>21){const nb=addBalance(userId,-bet);await message.reply(`${table(true)}\n\n💥 **Bust!** ${t} — lose **${bet.toLocaleString()} 💎**.\nBalance: **${nb.toLocaleString()} 💎**`+(bonuses.length?"\n"+bonuses.join("\n"):"")); break;}
        if(t===21)action="stand";
        else{await message.reply(`${table(true)}\n\nType \`hit\` or \`stand\`.`);continue;}
      }
      if(action==="stand"||action==="s"||action==="stop"){
        const thresh=blessed?14:17;
        while(handTotal(dh)<thresh)dh.push(deck.pop());
        const fp=handTotal(ph),fd=handTotal(dh);
        let line,nb,won=false;
        if(fd>21){nb=addBalance(userId,bet);line=`Meg busts! ✅ **${message.author.username}** wins **${bet.toLocaleString()} 💎**!`;won=true;}
        else if(fp>fd){nb=addBalance(userId,bet);line=`✅ **${message.author.username}** wins **${bet.toLocaleString()} 💎**!`;won=true;}
        else if(fd>fp){nb=addBalance(userId,-bet);line=`❌ Meg wins. Lose **${bet.toLocaleString()} 💎**.`;}
        else{nb=getBalance(userId);line=`🤝 Push — no change.`;}
        if(won)for(const q of trackEvent(userId,"blackjack_win")){const r=getQuestReward(q);addBalance(userId,r);bonuses.push(`🎯 **Beat the House** +${r.toLocaleString()} 💎`);}
        await message.reply(`${table(false)}\n\n${line}\nBalance: **${nb.toLocaleString()} 💎**`+(bonuses.length?"\n"+bonuses.join("\n"):"")); break;
      }
    }
  } finally { activePlayers.delete(userId); }
}

// ── Hunt ──────────────────────────────────────────────────────────
const ANIMALS=[
  {name:"Rabbit",emoji:"🐇",rarity:"common",   min:50,  max:150  },
  {name:"Duck",  emoji:"🦆",rarity:"common",   min:80,  max:180  },
  {name:"Fox",   emoji:"🦊",rarity:"common",   min:100, max:220  },
  {name:"Deer",  emoji:"🦌",rarity:"uncommon", min:300, max:600  },
  {name:"Boar",  emoji:"🐗",rarity:"uncommon", min:350, max:650  },
  {name:"Eagle", emoji:"🦅",rarity:"uncommon", min:400, max:750  },
  {name:"Wolf",  emoji:"🐺",rarity:"rare",     min:800, max:1400 },
  {name:"Bear",  emoji:"🐻",rarity:"rare",     min:1000,max:1800 },
  {name:"Panther",emoji:"🐆",rarity:"rare",    min:1200,max:2000 },
  {name:"Dragon",emoji:"🐉",rarity:"legendary",min:5000,max:8000 },
  {name:"Unicorn",emoji:"🦄",rarity:"legendary",min:6000,max:10000},
  {name:"Phoenix",emoji:"🔥",rarity:"legendary",min:8000,max:12000},
];
const RC={common:"⬜",uncommon:"🟩",rare:"🟦",legendary:"🟨"};
function pickAnimal(blessed){
  const w=blessed?{common:35,uncommon:28,rare:22,legendary:15}:{common:50,uncommon:25,rare:15,legendary:10};
  let roll=Math.random()*Object.values(w).reduce((a,b)=>a+b,0);
  let rarity="common";
  for(const[r,wt]of Object.entries(w)){roll-=wt;if(roll<=0){rarity=r;break;}}
  const pool=ANIMALS.filter(a=>a.rarity===rarity);
  return pool[Math.floor(Math.random()*pool.length)];
}
async function hunt(message){
  const userId=message.author.id;
  if(!hasEnough(userId,100)){await message.reply(`Need **100 💎** to hunt! Balance: **${getBalance(userId).toLocaleString()} 💎**`);return;}
  addBalance(userId,-100);
  const blessed=isBlessed(userId);
  if(Math.random()>(blessed?0.82:0.70)){const b=getBalance(userId);await message.reply(`🏹 **${message.author.username}** came back empty-handed! 😔\n(-100 💎 ammo)\nBalance: **${b.toLocaleString()} 💎**`);return;}
  const def=pickAnimal(blessed);
  const value=Math.floor(Math.random()*(def.max-def.min+1))+def.min;
  const animal={id:`${userId}-${Date.now()}`,name:def.name,emoji:def.emoji,rarity:def.rarity,value};
  addToInventory(userId,animal);
  const b=getBalance(userId);
  await message.reply(`🏹${blessed?" 🙏":""} **${message.author.username}** caught a...\n\n${def.emoji} **${def.name}** ${RC[def.rarity]} *${def.rarity}*\nValue: **${value.toLocaleString()} 💎**\n\nSell with \`Meg sell all\`!\nBalance: **${b.toLocaleString()} 💎** (-100 💎 ammo)`);
}
async function sellAnimals(message,args){
  const userId=message.author.id;
  const inv=getInventory(userId);
  if(!inv.length){await message.reply("Bag is empty! Try `Meg hunt`.");return;}
  const target=args[0]?.toLowerCase();
  if(!target||target==="all"){
    const animals=clearInventory(userId);
    const total=animals.reduce((s,a)=>s+a.value,0);
    const nb=addBalance(userId,total);
    await message.reply(`💰 Sold everything!\n\n${animals.map(a=>`${a.emoji} ${a.name} — **${a.value.toLocaleString()} 💎**`).join("\n")}\n\nTotal: **+${total.toLocaleString()} 💎**\nBalance: **${nb.toLocaleString()} 💎**`);
    return;
  }
  const idx=inv.findIndex(a=>a.name.toLowerCase()===target);
  if(idx===-1){await message.reply(`No **${target}** in your bag. Use \`Meg inv\` to check.`);return;}
  const animal=inv[idx];
  clearInventory(userId);
  inv.filter((_,i)=>i!==idx).forEach(a=>addToInventory(userId,a));
  const nb=addBalance(userId,animal.value);
  await message.reply(`💰 Sold ${animal.emoji} **${animal.name}** for **${animal.value.toLocaleString()} 💎**!\nBalance: **${nb.toLocaleString()} 💎**`);
}
async function showInventory(message){
  const inv=getInventory(message.author.id);
  if(!inv.length){await message.reply("🎒 Bag is empty! Try `Meg hunt`.");return;}
  const total=inv.reduce((s,a)=>s+a.value,0);
  await message.reply(`🎒 **${message.author.username}'s Bag** (${inv.length} animals)\n\n${inv.map((a,i)=>`${i+1}. ${a.emoji} **${a.name}** ${RC[a.rarity]} *${a.rarity}* — ${a.value.toLocaleString()} 💎`).join("\n")}\n\nTotal: **${total.toLocaleString()} 💎** · Sell with \`Meg sell all\``);
}

// ── Chat ──────────────────────────────────────────────────────────
function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}
const GREETINGS=["Heyyy! 👋 The casino's open — whatcha need?","Oh look who showed up! Ready to lose some 💎? 😈","HI! 😄 I was literally just waiting for someone to talk to me.","Heyyyy! What's good? The slots are VERY hungry today 🎰","Wassup! 😏 I've been sitting here counting other people's diamonds.","Oh hi!! I was starting to get bored. Let's gamble 😂","Hey hey HEY! 🎉 My favorite person just walked in."];
const HOW_ARE_YOU=["I'm doing amazing 💅 Just watching people go broke.","Rich and thriving 💎 How's YOUR balance looking?","Can't complain! The house always wins and I AM the house 🏠😂","Feeling lucky today! Whether YOU are is another question 🎲","Incredible. I won 47 imaginary bets today 😂"];
const THANKS=["Awww don't thank me, thank your bad luck 😂","You're welcome! Now go win some 💎 back!","No problem! Just don't come crying when you're broke 💀","Anytime bestie 💅 Now go gamble."];
const COMPLIMENTS=["Aww stop it, you're making me blush 🥺💎","I KNOW 😏 Thank you for noticing.","You're too sweet! I still won't go easy on you 😈","Omg thank youuu 🥺 You're my favorite. For now."];
const INSULTS=["Excuse me??? 😤 I'll remember this when you're begging for your diamonds back.","WOW. I did NOT deserve that 💀","Bold words from someone whose balance I can see 😏","I'm literally crying 😭 Just kidding. I don't have feelings. But I DO control the odds 😈"];
const BROKE=["Yikes 💀 Use `Meg daily` for 500 free 💎!","RIP wallet 😂 `Meg daily` every 24h for a free refill bestie.","That's rough... but `Meg daily` is right there!! 💎"];
const GOOD_MORNING=["Good morning!! ☀️ First thing: `Meg daily` for 500 💎!","Morning! 🌅 I've been up all night taking people's diamonds 😂","GOOD MORNING BESTIE ☀️ Ready to gamble away the day?"];

async function handleChat(message, body) {
  if (/^(hi+|hello+|hey+|sup|wassup|yo+|hiya)\b/.test(body)) { await message.reply(pick(GREETINGS)); return true; }
  if (/how are (you|u)|hru|how you doing/.test(body)) { await message.reply(pick(HOW_ARE_YOU)); return true; }
  if (/^(thanks|thank you|thx|ty|tysm)\b/.test(body)) { await message.reply(pick(THANKS)); return true; }
  if (/(you'?re|ur) (amazing|awesome|great|the best|cool|cute)/.test(body)||/i love (you|u|meg)/.test(body)) { await message.reply(pick(COMPLIMENTS)); return true; }
  if (/(you'?re|ur) (bad|trash|stupid|dumb|terrible|the worst)/.test(body)||/hate (you|u|meg)/.test(body)) { await message.reply(pick(INSULTS)); return true; }
  if (/\b(i'?m|im) (broke|poor)\b|broke|no diamonds/.test(body)) { await message.reply(pick(BROKE)); return true; }
  if (/\bgood\s*morning\b|\bgm\b/.test(body)) { await message.reply(pick(GOOD_MORNING)); return true; }
  if (/\bgood\s*night\b|\bgn\b/.test(body)) { const b=getBalance(message.author.id); await message.reply(`Good night! 🌙 Going to bed with **${b.toLocaleString()} 💎**. Dream of jackpots!`); return true; }
  return false;
}

// ── Main command handler ──────────────────────────────────────────
async function handleCommand(message) {
  const content = message.content.trim();
  const lower = content.toLowerCase();
  let bodyStart = -1;
  if (lower.startsWith("megan ")||lower==="megan") bodyStart=6;
  else if (lower.startsWith("meg ")||lower==="meg") bodyStart=4;
  if (bodyStart===-1) return;

  registerUsername(message.author.id, message.author.username);
  const parts = content.slice(bodyStart).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase()??"";
  const args = parts.slice(1);

  if (["cf","coinflip","coin"].includes(cmd)) { await coinflip(message, cmd==="coin"&&args[0]?.toLowerCase()==="flip"?args.slice(1):args); return; }
  if (["d","dice","roll"].includes(cmd)) { await dice(message, args); return; }
  if (["r","roulette"].includes(cmd)) { await roulette(message, args); return; }
  if (["s","sl","slot","slots"].includes(cmd)) { await slots(message, args); return; }
  if (["bj","blackjack"].includes(cmd)) { await blackjack(message, args); return; }
  if (["h","hunt"].includes(cmd)) { await hunt(message); return; }
  if (cmd==="sell") { await sellAnimals(message, args); return; }
  if (["inv","inventory","bag"].includes(cmd)) { await showInventory(message); return; }
  if (["bal","balance"].includes(cmd)) { const b=getBalance(message.author.id); await message.reply(`💎 **${message.author.username}**: **${b.toLocaleString()} 💎**`); return; }
  if (cmd==="daily") {
    const userId=message.author.id, now=Date.now(), last=dailyCooldowns.get(userId)??0, rem=86400000-(now-last);
    if(rem>0){const h=Math.floor(rem/3600000),m=Math.floor((rem%3600000)/60000);await message.reply(`⏳ Come back in **${h}h ${m}m**.`);return;}
    dailyCooldowns.set(userId,now);const nb=addBalance(userId,500);await message.reply(`🎁 **${message.author.username}** claimed **500 💎**!\nBalance: **${nb.toLocaleString()} 💎**`);return;
  }
  if (["lb","top","leaderboard"].includes(cmd)) {
    const board=getLeaderboard();if(!board.length){await message.reply("No one has played yet!");return;}
    const medals=["🥇","🥈","🥉"];
    await message.reply(`🏆 **Top ${board.length} Richest Players**\n\n${board.map((e,i)=>`${medals[i]??`**${i+1}.**`} **${e.username}** — ${e.balance.toLocaleString()} 💎`).join("\n")}`);return;
  }
  if (cmd==="quests"||cmd==="quest") {
    const statuses=getQuestStatus(message.author.id);
    const bar=(c,g)=>"▓".repeat(Math.min(Math.round(c/g*10),10))+"░".repeat(10-Math.min(Math.round(c/g*10),10));
    await message.reply(`📋 **${message.author.username}'s Daily Quests**\n\n${statuses.map(s=>s.completed?`✅ ~~**${s.def.name}**~~ **DONE** (+${s.def.reward.toLocaleString()} 💎)`:`🔲 **${s.def.name}** — ${s.def.desc}\n   ${bar(s.progress,s.def.goal)} ${s.progress}/${s.def.goal} · **${s.def.reward.toLocaleString()} 💎**`).join("\n\n")}`);return;
  }
  if (cmd==="pray") {
    const userId=message.author.id;
    if(isBlessed(userId)){await message.reply(`🙏 Already blessed! Expires in **${timeLeft(getPray(userId).boostUntil-Date.now())}**.`);return;}
    if(!canPray(userId)){await message.reply(`🕐 Try again in **${timeLeft(getPray(userId).nextAt-Date.now())}**.`);return;}
    activatePrayer(userId);
    await message.reply(`🙏 **${message.author.username}** prayed to the casino gods!\n**Blessed for 5 minutes** ✨\n- Coin flip: 65% win\n- Dice: +1 to roll\n- Roulette: 30% wheel nudge\n- Slots: better reel matching\n- Blackjack: Meg hits on 14\n\nPray again in 10 minutes.`);return;
  }
  if (cmd==="give") {
    const mentionMatch=args[0]?.match(/^<@!?(\d+)>$/);
    if(mentionMatch){
const targetId = mentionMatch[1];
const amount = parseInt(args[1]?.replace(/,/g, "") ?? "10");
      if(isNaN(amount)||amount<=0){await message.reply("Usage: `Meg give @user <amount>`");return;}
      const sb=getBalance(message.author.id);if(sb<amount){await message.reply(`Only have **${sb.toLocaleString()} 💎**!`);return;}
      const targetName=message.mentions.users.first()?.username??`<@${targetId}>`;
      registerUsername(targetId,targetName);addBalance(message.author.id,-amount);const tb=addBalance(targetId,amount);const nsb=getBalance(message.author.id);
      await message.reply(`💸 **${message.author.username}** sent **${amount.toLocaleString()} 💎** to **${targetName}**!\nYour balance: **${nsb.toLocaleString()} 💎**\n${targetName}'s balance: **${tb.toLocaleString()} 💎**`);return;
    }
    if(args[0]?.toLowerCase()==="me"){
      if(!GIVE_SECRET||args[args.length-1]!==GIVE_SECRET){await message.reply("Nice try 😏");return;}
const amount = parseInt(args[1]?.replace(/,/g, "") ?? "10");

if (isNaN(amount) || amount <= 0) {
    await message.reply("Usage: `Meg give me <amount> <secret>`");
    return;
}
      const nb=addBalance(message.author.id,amount);await message.reply(`💎 Added **${amount.toLocaleString()} 💎**! Balance: **${nb.toLocaleString()} 💎**`);return;
    }
    await message.reply("Nice try 😏");return;
  }
  if (cmd==="help"||cmd==="games") {
    await message.reply("**🎮 Meg Casino**\n\n`Meg cf <amount>` — Coin Flip\n`Meg dice <amount>` — Dice\n`Meg r <amount> <red|black|green|0-36>` — Roulette\n`Meg s <amount>` — Slots\n`Meg bj <amount>` — Blackjack\n`Meg hunt` — Hunt animals (100 💎)\n`Meg inv` — Inventory\n`Meg sell all` — Sell animals\n`Meg bal` — Balance\n`Meg daily` — 500 💎 every 24h\n`Meg quests` — Daily quests\n`Meg lb` — Leaderboard\n`Meg pray` — Luck boost 5 min\n`Meg give @user <amount>` — Send diamonds");return;
  }
  const handled = await handleChat(message, content.slice(bodyStart).trim().toLowerCase());
  if(!handled) await message.reply(`I don't know that one 😅 Type \`Meg help\`!`);
}

// ── Bot startup ───────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once("ready", () => {
  console.log(`✅ Meg is online as ${client.user.tag}`);
  client.user.setPresence({ status: "online", activities: [{ name: "💎 Meg Casino", type: ActivityType.Playing }] });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  try { await handleCommand(message); } catch (err) { console.error("Error:", err); }
});

client.login(TOKEN);
