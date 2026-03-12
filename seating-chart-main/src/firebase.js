import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCx3Ldz1wpJSSxpfchW6MdJ9AuMrthzllE",
  authDomain: "seating-auction-4a06f.firebaseapp.com",
  databaseURL: "https://seating-auction-4a06f-default-rtdb.firebaseio.com",
  projectId: "seating-auction-4a06f",
  storageBucket: "seating-auction-4a06f.firebasestorage.app",
  messagingSenderId: "526759778528",
  appId: "1:526759778528:web:d0dfd229304d52fc02d885"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);