import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCs1LOqsbrAjymIcjvbKxPhFQWXlSPiLTs",
  authDomain: "adrift-6c1f6.firebaseapp.com",
  projectId: "adrift-6c1f6",
  storageBucket: "adrift-6c1f6.appspot.com",
  messagingSenderId: "175846512414",
  appId: "1:175846512414:web:5c6e06d231ab58e9029b0f",
  measurementId: "G-L0P2EF6Q72",
  databaseURL: "https://adrift-6c1f6-default-rtdb.firebaseio.com/"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);