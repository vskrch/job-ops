import { LogIn, LogOut, Settings, User, UserPlus } from "lucide-react";
import type React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "../context/AuthContext";

export const UserDropdown: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  if (!auth || !auth.user) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5 font-medium"
        >
          <Link to="/login">
            <LogIn className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign in</span>
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="h-8 text-xs gap-1 font-medium hidden md:inline-flex"
        >
          <Link to="/register">
            <UserPlus className="h-3.5 w-3.5" />
            <span>Sign up</span>
          </Link>
        </Button>
      </div>
    );
  }

  const { user, logout } = auth;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 font-medium px-2"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            {user.name
              ? user.name.charAt(0).toUpperCase()
              : user.email.charAt(0).toUpperCase()}
          </div>
          <span className="hidden md:inline text-xs font-medium truncate max-w-[120px]">
            {user.name || user.email.split("@")[0]}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user.name || "User Account"}
            </p>
            <p className="text-xs leading-none text-muted-foreground truncate">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")}>
          <User className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>Account & Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/settings")}>
          <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
