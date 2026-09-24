import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data: books, error } = await supabase
    .from("books")
    .select("*");

  if (error) {
    return <p>Error loading books: {error.message}</p>;
  }

  return (
    <main style={{ padding: "40px" }}>
      <h1>My Book List</h1>

      <ul>
        {books?.map((book) => (
          <li key={book.id}>
            {book.title} by {book.author}
          </li>
        ))}
      </ul>
    </main>
  );
}