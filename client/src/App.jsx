import React, { use } from "react";
import { useState, useEffect } from "react";

import "./App.css"

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function App({}) {
    const [storageKey, setStorageKey] = useState(null);
    const [myImages, setImages] = useState([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [url, setUrl] = useState(null);

    function getPublicUrl(key) {
        if (!key) return;
        return `https://s3.twcstorage.ru/3e88f5e3-35cc-4a02-9d3c-95cfbb3707c0/${key}`;
    }

    useEffect(() => {
        async function getKeys() {
            const res = await fetch(API_URL + '/files/allkeys', { method: 'GET' });
            const data = await res.json();
            if (data.success) {
                setImages((prev) => [...prev, ...data.keys]);
            } else {
                alert('Ошибка загрузки файлов: ', data.error);
            }
        }
        getKeys();
    }, []);

    async function uploadViaBuffer(file) {
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(API_URL + '/s3/upload', {
                method: 'POST',
                body: formData,
            });
            const resJson = await res.json();
            setStorageKey(resJson.key);
            setUrl(url)
            setImages((prev) => [...prev, {
                filename: file.name,
                createdAt: Date.now(),
                storageKey: resJson.key
            }]);
        } catch (err) {
            console.error('Ошибка загрузки файла:', err);
        }
    }
    function uploadWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('purpose', 'avatar');
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', API_URL + '/s3/stream-upload');

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    reject(new Error('Ошибка загрузки: ' + xhr.status));
                }
            };
            xhr.onerror = () => reject(new Error('Сетевая ошибка'));

            xhr.send(formData);
        });
    }
    async function uploadViaStream(file) {
        if (!file) return;
        setUploadProgress(0);
        try {
            const result = await uploadWithProgress(file, setUploadProgress); // ждём, пока Promise выполнится (resolve)
            console.log('Успех:', result.key);
            setImages((prev) => [...prev, {
                filename: file.name,
                createdAt: Date.now(),
                storageKey: result.key
            }]);
            setStorageKey(result.key);
        } catch (err) {
            console.log('Ошибка:', err.message); // сюда попадём, если был reject
        } finally {
            setUploadProgress(0);
        }
    }
    async function uploadDirectToS3(file) {
        if (!file) return;
        const query = new URLSearchParams({filename: file.name, type: file.type, size: file.size});
        const res = await fetch(`${API_URL}/s3/presigned-upload-url?${query.toString()}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Не удалось получить ссылку');
        }
        const { url, key } = await res.json();
        const uploadRes = await fetch(url, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type, // должен совпадать с тем, что было при генерации ссылки
            },
        });

        if (!uploadRes.ok) {
            throw new Error('Не удалось загрузить файл в хранилище');
        }
        setUrl(url)
        setStorageKey(key);
        // 3. Сообщаем своему серверу, что файл загружен
        const confirmQuery = new URLSearchParams({ key, filename: file.name });
        const confirmRes = await fetch(`${API_URL}/s3/confirm-upload?${confirmQuery.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!confirmRes.ok) {
            throw new Error('Не удалось подтвердить загрузку');
        }
        const confirmResj = await confirmRes.json();
        setImages((prev) => [...prev, {
                filename: file.name,
                createdAt: Date.now(),
                storageKey: confirmResj.storageKey
        }]);
        return confirmResj;
        
    }
    async function uploadViaUrl(file) {
        try {
            const result = await uploadDirectToS3(file);
            console.log('Успех:', result);
        } catch (err) {
            console.error('Ошибка:', err.message); // сюда прилетит наш throw
        }
    }

    return (
        <div className="main">
            <p>S3 Bucket: <a href="https://timeweb.cloud/my/storage/562591/dashboard" target="_blank">3e88f5e3-35cc-4a02-9d3c-95cfbb3707c0</a></p>
            <label>
                Upload Image via server's buffer
                <input type="file" accept="image/*" onChange={(e) => uploadViaBuffer(e.target.files[0])}/>
            </label>
            <label>
                Upload Image via stream
                {uploadProgress > 0 && (
                    <div>
                        <progress value={uploadProgress} max="100" />
                        <span>{uploadProgress}%</span>
                    </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => uploadViaStream(e.target.files[0])}/>
            </label>
            <label>
                Upload Image via url
                <input type="file" accept="image/*" onChange={(e) => uploadViaUrl(e.target.files[0])}/>
                <p>{url && `Url: ${url}`}</p>
            </label>
            <div>
                <p>Загруженные картинки:</p>
                <ul>
                    {myImages.map((img) => (
                        <li key={img.storageKey}>
                            <p>{img.filename}</p>
                            <p>{new Date(img.createdAt).toLocaleDateString('ru-RU')}</p>
                            <img src={getPublicUrl(img.storageKey)} alt={img.name} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}