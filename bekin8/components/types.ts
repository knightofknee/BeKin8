// components/types.ts
export type Friend = { uid?: string; username: string };

export type FriendRequest = {
  id: string;
  senderUid: string;
  receiverUid: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt?: any;
  updatedAt?: any;
  senderUsername?: string;
  receiverUsername?: string;
};

export type Edge = { id: string; uids: string[]; state: "accepted" | "blocked" | "pending" };

export type MessageState = { text: string; type: "error" | "success" | null };