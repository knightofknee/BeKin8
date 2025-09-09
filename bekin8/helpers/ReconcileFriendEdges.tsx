import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";

export async function reconcileFriendEdges() {
  const me = auth.currentUser;
  if (!me) return;

  // 1) Load my current friends (uids set for quick contains)
  const myFriendsRef = doc(db, "Friends", me.uid);
  const myFriendsSnap = await getDoc(myFriendsRef);
  const myFriends: Array<{uid?: string; username: string}> = (myFriendsSnap.data()?.friends ?? []);
  const myFriendUids = new Set(myFriends.map(f => f.uid).filter(Boolean) as string[]);

  // 2) Find accepted requests involving me (either direction)
  const FR = collection(db, "FriendRequests");
  const qAcceptedToMe   = query(FR, where("receiverUid", "==", me.uid), where("status", "==", "accepted"));
  const qAcceptedFromMe = query(FR, where("senderUid", "==", me.uid),   where("status", "==", "accepted"));

  const [snapA, snapB] = await Promise.all([getDocs(qAcceptedToMe), getDocs(qAcceptedFromMe)]);
  const acceptedDocs = [...snapA.docs, ...snapB.docs];

  for (const d of acceptedDocs) {
    const req = d.data() as any;
    const otherUid = req.senderUid === me.uid ? req.receiverUid : req.senderUid;
    const otherUsername = req.senderUid === me.uid ? req.receiverUsername : req.senderUsername;

    // If my edge missing, add it
    if (!myFriendUids.has(otherUid)) {
      await setDoc(
        myFriendsRef,
        { friends: arrayUnion({ uid: otherUid, username: otherUsername || otherUid }) },
        { merge: true }
      );
      myFriendUids.add(otherUid);
    }

    // If BOTH sides have edges, mark completed
    const otherFriendsSnap = await getDoc(doc(db, "Friends", otherUid));
    const otherHasMe = (otherFriendsSnap.data()?.friends ?? []).some((f: any) => f?.uid === me.uid);

    if (otherHasMe && myFriendUids.has(otherUid)) {
      await updateDoc(doc(db, "FriendRequests", d.id), {
        status: "completed",
        updatedAt: serverTimestamp(),
      });
    }
  }
}
