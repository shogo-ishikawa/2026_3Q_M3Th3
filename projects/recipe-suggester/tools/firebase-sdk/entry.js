export {initializeApp} from 'firebase/app';
export {
  beforeAuthStateChanged, getAuth, getIdTokenResult, GoogleAuthProvider, onIdTokenChanged,
  reauthenticateWithPopup, signInWithPopup, signOut
} from 'firebase/auth';
export {
  collection, doc, getCountFromServer, getDocFromServer, getFirestore, onSnapshot,
  or, query, runTransaction, where
} from 'firebase/firestore';
