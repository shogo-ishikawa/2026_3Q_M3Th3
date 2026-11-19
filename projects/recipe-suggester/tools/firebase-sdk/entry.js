export {initializeApp} from 'firebase/app';
export {
  beforeAuthStateChanged, getAuth, getIdTokenResult, GoogleAuthProvider, onIdTokenChanged,
  signInWithPopup, signOut
} from 'firebase/auth';
export {
  collection, doc, getCountFromServer, getDocFromServer, getFirestore, onSnapshot,
  query, runTransaction, where
} from 'firebase/firestore';
