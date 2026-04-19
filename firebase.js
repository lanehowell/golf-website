import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
  import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
  import {
    getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, orderBy, limit
  } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyB69dwNj-dMTn_1f0Ex4Oq_axpqihJzAl8",
    authDomain: "golf-site-525a9.firebaseapp.com",
    projectId: "golf-site-525a9",
    storageBucket: "golf-site-525a9.firebasestorage.app",
    messagingSenderId: "905202969291",
    appId: "1:905202969291:web:d073923513df924ca5494e"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();

  // Expose a tiny API on window for the main (non-module) script to use.
  window.fb = {
    auth,
    db,
    signIn: () => signInWithPopup(auth, provider),
    signOut: () => signOut(auth),
    // Firestore helpers — wrapped so the main script doesn't have to import.
    setDoc: (path, data) => setDoc(doc(db, path), data),
    deleteDoc: (path) => deleteDoc(doc(db, path)),
    getDoc: async (path) => {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? snap.data() : null;
    },
    listDocs: async (collectionPath, opts = {}) => {
      let ref = collection(db, collectionPath);
      const constraints = [];
      if (opts.orderBy) constraints.push(orderBy(opts.orderBy, opts.orderDir || 'desc'));
      if (opts.limit) constraints.push(limit(opts.limit));
      const q = constraints.length ? query(ref, ...constraints) : ref;
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    currentUser: () => auth.currentUser
  };

  // Push auth state changes into the main script via a custom event.
  onAuthStateChanged(auth, (user) => {
    window.dispatchEvent(new CustomEvent('fb-auth-changed', { detail: user }));
  });
