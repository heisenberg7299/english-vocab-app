// Bridges storage.js's local cache to Firestore, so the same vocabulary
// list and review stats follow the user across devices once logged in.
// Loaded from Firebase's CDN — no build step needed.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=29";
import * as store from "./storage.js?v=29";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}
export function logIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function logOut() {
  stopSync();
  return signOut(auth);
}

const changeListeners = [];
export function onRemoteChange(cb) {
  changeListeners.push(cb);
}
function notifyChange() {
  changeListeners.forEach((cb) => cb());
}

let unsubWords = null;
let unsubLocalWrites = null;

export async function startSync(uid) {
  const wordsCol = collection(db, "users", uid, "words");
  const statsRef = doc(db, "users", uid, "meta", "stats");

  // One-time merge on first sync from this device: fill in any words that
  // exist locally but not yet in the cloud, without clobbering cloud data.
  const existing = await getDocs(wordsCol);
  const cloudWordKeys = new Set(existing.docs.map((d) => d.id));
  const localOnly = store.loadWords().filter((w) => !cloudWordKeys.has(w.word.toLowerCase()));
  await Promise.all(
    localOnly.map((w) => setDoc(doc(wordsCol, w.word.toLowerCase()), w))
  );

  // Merge review-streak history the same way (union of both devices' dates)
  const cloudStatsSnap = await getDocs(collection(db, "users", uid, "meta"));
  const cloudStats = cloudStatsSnap.docs.find((d) => d.id === "stats")?.data();
  const localStats = store.loadStats();
  const mergedDates = [
    ...new Set([...(cloudStats?.reviewedDates || []), ...(localStats.reviewedDates || [])]),
  ];
  await setDoc(statsRef, { reviewedDates: mergedDates });

  // Live sync: any change in Firestore (from this device or another) flows
  // into the local cache and re-renders whatever's on screen.
  unsubWords = onSnapshot(wordsCol, (snap) => {
    store.replaceWords(snap.docs.map((d) => d.data()));
    notifyChange();
  });
  const unsubStats = onSnapshot(statsRef, (snap) => {
    if (snap.exists()) {
      store.replaceStats(snap.data());
      notifyChange();
    }
  });
  const stopWords = unsubWords;
  unsubWords = () => {
    stopWords();
    unsubStats();
  };

  // Local writes (from this device, while online) flow up to Firestore.
  unsubLocalWrites = store.onWrite((type, payload) => {
    if (type === "upsertWord") {
      setDoc(doc(wordsCol, payload.word.toLowerCase()), payload).catch(() => {});
    } else if (type === "deleteWord") {
      deleteDoc(doc(wordsCol, payload.toLowerCase())).catch(() => {});
    } else if (type === "recordReviewToday") {
      setDoc(statsRef, payload).catch(() => {});
    }
  });
}

export function stopSync() {
  unsubWords?.();
  unsubLocalWrites?.();
  unsubWords = null;
  unsubLocalWrites = null;
}
