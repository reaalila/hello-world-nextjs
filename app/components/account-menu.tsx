import Link from "next/link";
import styles from "./account-menu.module.css";

type AccountMenuProps = {
  isLoggedIn: boolean;
};

export default function AccountMenu({
  isLoggedIn,
}: AccountMenuProps) {
  if (!isLoggedIn) {
    return (
      <Link href="/login" className={styles.signIn}>
        SIGN IN ↗
      </Link>
    );
  }

  return (
    <details className={styles.menu}>
      <summary
        className={styles.trigger}
        aria-label="Account menu"
        title="Account menu"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" />
        </svg>

        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </summary>

      <div className={styles.dropdown}>
        <Link href="/profile" className={styles.menuItem}>
          MY PROFILE
        </Link>

        <form action="/auth/signout" method="post">
          <button type="submit" className={styles.signOut}>
            SIGN OUT ↗
          </button>
        </form>
      </div>
    </details>
  );
}
