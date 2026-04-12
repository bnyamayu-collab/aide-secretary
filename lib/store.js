// =====================================================================
// Firebase Admin — Firestore storage for memos, tasks, calendar events
// =====================================================================
import admin from 'firebase-admin';

let db = null;

function getDb() {
  if (db) return db;
  if (!admin.apps.length) {
    const cred = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!cred) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(cred)),
    });
  }
  db = admin.firestore();
  return db;
}

// ---------- Generic helpers ----------
function userCol(userId, kind) {
  return getDb().collection('lineUsers').doc(userId).collection(kind);
}

// ---------- Memos ----------
export async function addMemo(userId, memo) {
  const ref = userCol(userId, 'memos');
  const doc = await ref.add({
    text: memo.text,
    source: memo.source || 'line',
    imageDescription: memo.imageDescription || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return doc.id;
}

export async function getMemos(userId, limit = 10) {
  const snap = await userCol(userId, 'memos')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteMemo(userId, memoId) {
  await userCol(userId, 'memos').doc(memoId).delete();
}

// ---------- Tasks ----------
export async function addTask(userId, task) {
  const ref = userCol(userId, 'tasks');
  const doc = await ref.add({
    title: task.title,
    due: task.due || null,
    note: task.note || '',
    done: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return doc.id;
}

export async function getTasks(userId, onlyPending = true) {
  let q = userCol(userId, 'tasks').orderBy('createdAt', 'desc');
  const snap = await q.get();
  let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (onlyPending) tasks = tasks.filter(t => !t.done);
  return tasks;
}

export async function completeTask(userId, taskId) {
  await userCol(userId, 'tasks').doc(taskId).update({ done: true });
}

export async function deleteTask(userId, taskId) {
  await userCol(userId, 'tasks').doc(taskId).delete();
}

// ---------- User preferences ----------
export async function getProfile(userId) {
  const doc = await getDb().collection('lineUsers').doc(userId).get();
  return doc.exists ? doc.data() : {};
}

export async function updateProfile(userId, data) {
  await getDb().collection('lineUsers').doc(userId).set(data, { merge: true });
}

// ---------- Get all LINE user IDs (for broadcast like weather) ----------
export async function getAllUserIds() {
  const snap = await getDb().collection('lineUsers').where('registered', '==', true).get();
  return snap.docs.map(d => d.id);
}
