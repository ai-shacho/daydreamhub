#!/usr/bin/env node
/**
 * wp_users → Cloudflare D1 移行スクリプト
 * 仮パスワード: DaydreamHub2026
 */

const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const path = require('path');

// ====== 設定 ======
const WP_USERS_FILE = '/Users/byaoluajnicreo/.openclaw/media/inbound/20260322_wp_users---2152f7d6-f04f-4e27-8f76-e40374c03c15';
const TEMP_PASSWORD = 'DaydreamHub2026';
const OUTPUT_SQL = path.join(__dirname, 'migration.sql');
const PROJECT_DIR = '/Users/byaoluajnicreo/Desktop/daydreamhub';
const DB_NAME = 'daydreamhub-db';

// 除外するuser_login
const EXCLUDED_LOGINS = new Set([
  'kyodake',
  'sales_owner',
  'owner_shimizu',
  'ddh_develop',
  'test.test',
  'PreListing_test_owner',
]);

// ====== SHA-256ハッシュ計算 ======
const passwordHash = crypto.createHash('sha256').update(TEMP_PASSWORD).digest('hex');
console.log(`SHA-256(${TEMP_PASSWORD}) = ${passwordHash}`);

// ====== SQLダンプをパース ======
const rawSql = fs.readFileSync(WP_USERS_FILE, 'utf8');

// INSERT INTO `u` (...) VALUES (...), (...) の部分を抽出
const insertMatch = rawSql.match(/INSERT INTO `u`[^;]+;/s);
if (!insertMatch) {
  console.error('INSERT文が見つかりません');
  process.exit(1);
}

// VALUES の各行をパース
const valuesSection = insertMatch[0].match(/VALUES\s*([\s\S]+);$/s);
if (!valuesSection) {
  console.error('VALUESが見つかりません');
  process.exit(1);
}

// 各レコードをパース
// (ID, user_login, user_pass, user_nicename, user_email, user_url, user_registered, user_activation_key, user_status, display_name)
const recordRegex = /\((\d+),\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*'((?:[^'\\]|\\.|'')*)'\)/g;

const users = [];
let match;
const rawValues = valuesSection[1];

// より堅牢なパーサー：行ごとに分割して処理
// レコードを抽出するためにシンプルなアプローチ
const lines = rawValues.split('\n').join(' ');

// 各ユーザーレコードを手動でパース
function parseWpUsers(sql) {
  const results = [];
  
  // VALUES以降を取得
  const valStart = sql.indexOf('VALUES');
  if (valStart === -1) return results;
  
  let pos = valStart + 6; // 'VALUES'の後
  
  // 各タプルを処理
  while (pos < sql.length) {
    // '(' を探す
    while (pos < sql.length && sql[pos] !== '(') pos++;
    if (pos >= sql.length) break;
    
    pos++; // '(' をスキップ
    
    const fields = [];
    let field = '';
    let inStr = false;
    
    while (pos < sql.length) {
      const ch = sql[pos];
      
      if (inStr) {
        if (ch === "'") {
          // エスケープされた '' ?
          if (sql[pos + 1] === "'") {
            field += "'";
            pos += 2;
          } else {
            inStr = false;
            pos++;
          }
        } else if (ch === '\\') {
          field += sql[pos + 1] || '';
          pos += 2;
        } else {
          field += ch;
          pos++;
        }
      } else {
        if (ch === "'") {
          inStr = true;
          pos++;
        } else if (ch === ',') {
          fields.push(field.trim());
          field = '';
          pos++;
        } else if (ch === ')') {
          fields.push(field.trim());
          pos++;
          break;
        } else {
          field += ch;
          pos++;
        }
      }
    }
    
    if (fields.length >= 10) {
      results.push({
        ID: parseInt(fields[0]),
        user_login: fields[1],
        user_pass: fields[2],
        user_nicename: fields[3],
        user_email: fields[4],
        user_url: fields[5],
        user_registered: fields[6],
        user_activation_key: fields[7],
        user_status: parseInt(fields[8]),
        display_name: fields[9],
      });
    }
  }
  
  return results;
}

const allUsers = parseWpUsers(rawSql);
console.log(`\n全ユーザー数: ${allUsers.length}`);

// フィルタリング
const filteredUsers = allUsers.filter(u => {
  if (EXCLUDED_LOGINS.has(u.user_login)) {
    console.log(`  除外(login): ${u.user_login}`);
    return false;
  }
  if (!u.user_email || u.user_email.trim() === '') {
    console.log(`  除外(email空): ${u.user_login} / ${u.display_name}`);
    return false;
  }
  return true;
});

console.log(`\n移行対象ユーザー数: ${filteredUsers.length}`);

// ====== SQL生成 ======
const sqlLines = [];
sqlLines.push('-- wp_users → D1 移行SQL');
sqlLines.push(`-- 生成日時: ${new Date().toISOString()}`);
sqlLines.push(`-- 仮パスワード: ${TEMP_PASSWORD}`);
sqlLines.push(`-- パスワードハッシュ: ${passwordHash}`);
sqlLines.push('');

// SQL エスケープ関数
function sqlEscape(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// 1. users INSERT
sqlLines.push('-- === users テーブル INSERT ===');
for (const u of filteredUsers) {
  const name = sqlEscape(u.display_name || u.user_login);
  const email = sqlEscape(u.user_email.trim().toLowerCase());
  const hash = sqlEscape(passwordHash);
  const role = sqlEscape('user');
  sqlLines.push(
    `INSERT OR REPLACE INTO users (name, email, password_hash, role) VALUES (${name}, ${email}, ${hash}, ${role});`
  );
}

sqlLines.push('');
sqlLines.push('-- === hotels.email UPDATE ===');

// 2. hotels UPDATE
const noMatchUsers = [];
for (const u of filteredUsers) {
  const nicename = u.user_nicename;
  if (!nicename || nicename.trim() === '') {
    noMatchUsers.push({ user: u, reason: 'user_nicenameが空' });
    continue;
  }
  
  // LIKE '{nicename}%' でhotels.slugと照合
  const likePattern = sqlEscape(nicename + '%');
  const email = sqlEscape(u.user_email.trim().toLowerCase());
  
  sqlLines.push(
    `UPDATE hotels SET email = ${email} WHERE slug LIKE ${likePattern} AND (email IS NULL OR email = '');`
  );
}

sqlLines.push('');
sqlLines.push('-- 以上');

const sqlContent = sqlLines.join('\n');

// ====== SQLファイルに書き出し ======
fs.writeFileSync(OUTPUT_SQL, sqlContent, 'utf8');
console.log(`\nSQLファイル生成完了: ${OUTPUT_SQL}`);
console.log(`  users INSERT: ${filteredUsers.length}件`);

// ====== 手動確認が必要なユーザー ======
console.log('\n=== スラッグ不一致・要確認ユーザー ===');
if (noMatchUsers.length === 0) {
  console.log('  なし');
} else {
  for (const { user, reason } of noMatchUsers) {
    console.log(`  - ${user.display_name} (login: ${user.user_login}, reason: ${reason})`);
  }
}

// ====== wrangler経由でD1に適用 ======
console.log('\n====== wrangler D1 実行 ======');
try {
  const result = execSync(
    `cd ${PROJECT_DIR} && npx wrangler d1 execute ${DB_NAME} --remote --file=scripts/migration.sql 2>&1`,
    { encoding: 'utf8', timeout: 120000 }
  );
  console.log(result);
} catch (err) {
  console.error('wrangler実行エラー:');
  console.error(err.stdout || err.message);
  process.exit(1);
}

console.log('\n====== 移行完了 ======');
console.log(`移行ユーザー数: ${filteredUsers.length}`);
console.log(`仮パスワード: ${TEMP_PASSWORD}`);
console.log(`ハッシュ: ${passwordHash}`);
