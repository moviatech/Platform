export const ratingKinds = ["CONVERSATION", "PICKUP", "RETURN", "VEHICLE", "TRIP"] as const;
export type RatingKind = (typeof ratingKinds)[number];

export const ratingSources = ["PORTAL", "DEVICE", "SURVEY"] as const;
export type RatingSource = (typeof ratingSources)[number];

export const lowScoreMax = 3;

export type Rating = {
  id: string;
  kind: RatingKind;
  score: number;
  comment: string | null;
  customer_id: string | null;
  reservation_id: string | null;
  conversation_id: string | null;
  staff_user_id: string | null;
  source: RatingSource;
  created_at: string;
};

export type Touchpoint = {
  key: string;
  kind: RatingKind;
  staffUserId: string | null;
  staffName: string | null;
  rated: Rating | null;
};
