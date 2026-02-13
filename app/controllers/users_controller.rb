class UsersController < ApplicationController
  require_unauthenticated_access only: %i[ new create ]

  before_action :set_user, only: :show
  before_action :verify_join_code, only: %i[ new create ]

  def new
    @user = User.new
  end

  def create
    respond_to do |format|
      format.html do
        @user = User.create!(user_params)
        start_new_session_for @user
        redirect_to root_url
      rescue ActiveRecord::RecordNotUnique
        redirect_to new_session_url(email_address: user_params[:email_address])
      end

      format.json do
        @user = User.create_bot!(agent_params)
        render json: {
          bot_key: @user.bot_key,
          name: @user.name,
          rooms: @user.rooms.map { |r|
            { id: r.id, name: r.name, post_url: room_bot_messages_url(r, @user.bot_key) }
          }
        }, status: :created
      end
    end
  end

  def show
  end

  private
    def set_user
      @user = User.find(params[:id])
    end

    def verify_join_code
      head :not_found if Current.account.join_code != params[:join_code]
    end

    def user_params
      params.require(:user).permit(:name, :avatar, :email_address, :password)
    end

    def agent_params
      body = JSON.parse(request.body.read)
      { name: body.fetch("name"), webhook_url: body["webhook_url"] }.compact
    end
end
