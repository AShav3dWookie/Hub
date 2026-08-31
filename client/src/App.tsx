import { Routes, Route } from "react-router-dom";
import { useSyncBootstrap } from "./sync/useSyncBootstrap.js";
import { Layout } from "./components/Layout.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { Home } from "./routes/Home.js";
import { Add } from "./routes/Add.js";
import { AddCategory } from "./routes/AddCategory.js";
import { Search } from "./routes/Search.js";
import { EntityDetail } from "./routes/EntityDetail.js";
import { PersonProfile } from "./routes/PersonProfile.js";
import { Gallery } from "./routes/Gallery.js";
import { Albums } from "./routes/Albums.js";
import { AlbumDetail } from "./routes/AlbumDetail.js";
import { Calendar } from "./routes/Calendar.js";
import { Login } from "./routes/Login.js";

export function App() {
  useSyncBootstrap();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/add" element={<Add />} />
                <Route path="/add/:category" element={<AddCategory />} />
                <Route path="/search" element={<Search />} />
                <Route path="/gallery" element={<Gallery />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/albums" element={<Albums />} />
                <Route path="/album/:id" element={<AlbumDetail />} />
                <Route path="/entity/:id" element={<EntityDetail />} />
                <Route path="/person/:id" element={<PersonProfile />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
