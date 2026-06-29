package dto

type UpdateUserRequest struct {
	Nickname  *string `json:"nickname" binding:"omitempty,min=1,max=100"`
	AvatarURL *string `json:"avatar_url" binding:"omitempty,url"`
	Bio       *string `json:"bio" binding:"omitempty,max=500"`
}

type UserResponse struct {
	ID        string  `json:"id"`
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
	Bio       *string `json:"bio"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}
